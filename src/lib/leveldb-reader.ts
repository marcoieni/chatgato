// Read the live files without opening LevelDB, acquiring its lock, or writing
// recovery files. Formats: https://github.com/google/leveldb/tree/main/doc
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { uncompress } from "snappyjs";

const MAX_BYTES = 64 * 1024 * 1024;
const BLOCK_BYTES = 32768;
export class BinaryReader {
  offset = 0;
  constructor(readonly buffer: Buffer) {}
  take(length: number): Buffer {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      this.offset + length > this.buffer.length
    )
      throw new Error("Invalid LevelDB record length");
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  byte(): number {
    return this.take(1)[0]!;
  }
  varint(): number {
    let value = 0;
    for (let shift = 0; shift <= 49; shift += 7) {
      const byte = this.byte();
      value += (byte & 127) * 2 ** shift;
      if (!Number.isSafeInteger(value)) break;
      if (!(byte & 128)) return value;
    }
    throw new Error("Invalid LevelDB integer");
  }
  bytes(): Buffer {
    return this.take(this.varint());
  }
}

export function unsnappy(data: Buffer): Buffer {
  if (new BinaryReader(data).varint() > MAX_BYTES)
    throw new Error("LevelDB value is too large");
  return Buffer.from(uncompress(data));
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++)
    value = (value >>> 1) ^ (value & 1 ? 0x82f63b78 : 0);
  return value >>> 0;
});
export function maskedCrc32c(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!;
  crc = ~crc >>> 0;
  return (((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0;
}

export function* logRecords(data: Buffer): Generator<Buffer> {
  let offset = 0;
  let parts: Buffer[] | undefined;
  let length = 0;
  while (offset + 7 <= data.length) {
    const remaining = BLOCK_BYTES - (offset % BLOCK_BYTES);
    if (remaining < 7) {
      offset += remaining;
      continue;
    }
    const size = data.readUInt16LE(offset + 4);
    const type = data[offset + 6]!;
    if (type === 0 && size === 0) {
      offset += remaining;
      parts = undefined;
      continue;
    }
    if (size + 7 > remaining) throw new Error("Invalid LevelDB log fragment");
    // A writer can be halfway through the final fragment or logical record.
    if (offset + 7 + size > data.length) break;
    const fragment = data.subarray(offset + 7, offset + 7 + size);
    if (
      maskedCrc32c(data.subarray(offset + 6, offset + 7 + size)) !==
      data.readUInt32LE(offset)
    )
      throw new Error("Invalid LevelDB log checksum");
    offset += 7 + size;
    if (type === 1) {
      parts = undefined;
      yield fragment;
    } else if (type === 2) {
      parts = [fragment];
      length = size;
    } else if ((type === 3 || type === 4) && parts) {
      length += size;
      if (length > MAX_BYTES)
        throw new Error("LevelDB log record is too large");
      parts.push(fragment);
      if (type === 4) {
        yield Buffer.concat(parts);
        parts = undefined;
      }
    } else throw new Error("Invalid LevelDB log sequence");
  }
}

type Entry = { key: Buffer; value: Buffer | null; sequence: bigint };
function* writeBatch(data: Buffer): Generator<Entry> {
  const reader = new BinaryReader(data);
  const sequence = reader.take(8).readBigUInt64LE();
  const count = reader.take(4).readUInt32LE();
  const entries: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const type = reader.byte();
    if (type !== 0 && type !== 1)
      throw new Error("Invalid LevelDB batch operation");
    const key = reader.bytes();
    entries.push({
      key,
      value: type === 1 ? reader.bytes() : null,
      sequence: sequence + BigInt(i),
    });
  }
  if (reader.offset !== data.length)
    throw new Error("Invalid LevelDB batch size");
  yield* entries;
}

function* blockEntries(
  data: Buffer,
): Generator<{ key: Buffer; value: Buffer }> {
  const restarts = data.readUInt32LE(data.length - 4);
  const limit = data.length - 4 - restarts * 4;
  if (limit < 0) throw new Error("Invalid LevelDB restart array");
  const reader = new BinaryReader(data.subarray(0, limit));
  let key = Buffer.alloc(0);
  while (reader.offset < limit) {
    const shared = reader.varint(),
      unshared = reader.varint(),
      size = reader.varint();
    if (shared > key.length) throw new Error("Invalid LevelDB shared key");
    key = Buffer.concat([key.subarray(0, shared), reader.take(unshared)]);
    yield { key, value: reader.take(size) };
  }
}

function tableBlock(table: Buffer, handle: BinaryReader): Buffer {
  const offset = handle.varint(),
    size = handle.varint();
  if (size > MAX_BYTES || offset + size + 5 > table.length - 48)
    throw new Error("Invalid LevelDB block handle");
  const data = table.subarray(offset, offset + size);
  const compression = table[offset + size];
  if (
    maskedCrc32c(table.subarray(offset, offset + size + 1)) !==
    table.readUInt32LE(offset + size + 1)
  )
    throw new Error("Invalid LevelDB table checksum");
  if (compression === 0) return data;
  if (compression === 1) return unsnappy(data);
  throw new Error("Unsupported LevelDB compression");
}

function tableEntries(table: Buffer): Entry[] {
  if (
    table.length < 48 ||
    table.readBigUInt64LE(table.length - 8) !== 0xdb4775248b80fb57n
  )
    throw new Error("Invalid LevelDB table footer");
  const footer = new BinaryReader(table.subarray(-48));
  footer.varint();
  footer.varint(); // metaindex handle
  const entries: Entry[] = [];
  for (const index of blockEntries(tableBlock(table, footer))) {
    for (const { key, value } of blockEntries(
      tableBlock(table, new BinaryReader(index.value)),
    )) {
      if (key.length < 8) throw new Error("Invalid LevelDB internal key");
      const trailer = key.readBigUInt64LE(key.length - 8);
      const type = Number(trailer & 255n);
      if (type !== 0 && type !== 1)
        throw new Error("Invalid LevelDB value type");
      entries.push({
        key: key.subarray(0, -8),
        value: type === 1 ? value : null,
        sequence: trailer >> 8n,
      });
    }
  }
  return entries;
}

function manifestFiles(data: Buffer) {
  const tables = new Set<number>();
  let log = 0,
    previousLog = 0;
  for (const record of logRecords(data)) {
    const reader = new BinaryReader(record);
    while (reader.offset < record.length) {
      switch (reader.varint()) {
        case 1:
          reader.bytes();
          break; // comparator
        case 2:
          log = reader.varint();
          break;
        case 3:
        case 4:
          reader.varint();
          break; // next file, last sequence
        case 5:
          reader.varint();
          reader.bytes();
          break; // compaction pointer
        case 6:
          reader.varint();
          tables.delete(reader.varint());
          break;
        case 7:
          reader.varint();
          tables.add(reader.varint());
          reader.varint();
          reader.bytes();
          reader.bytes();
          break;
        case 9:
          previousLog = reader.varint();
          break;
        default:
          throw new Error("Unsupported LevelDB manifest record");
      }
    }
  }
  return { tables, log, previousLog };
}

async function boundedRead(path: string): Promise<Buffer> {
  if ((await stat(path)).size > MAX_BYTES)
    throw new Error("LevelDB file is too large");
  const data = await readFile(path);
  if (data.length > MAX_BYTES) throw new Error("LevelDB file is too large");
  return data;
}

export class LevelDbReader {
  private tables = new Map<string, { stamp: string; entries: Entry[] }>();
  async read(directory: string): Promise<Entry[]> {
    // Retry when compaction replaces files during this read. Never resurrect
    // obsolete SST records by scanning files no longer named by the manifest.
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.snapshot(directory);
      } catch (error) {
        if (attempt >= 2) throw error;
      }
    }
  }

  private async snapshot(directory: string): Promise<Entry[]> {
    const current = (await boundedRead(join(directory, "CURRENT")))
      .toString()
      .trim();
    if (!/^MANIFEST-\d+$/.test(current))
      throw new Error("Invalid LevelDB manifest name");
    const manifestPath = join(directory, current);
    const manifest = await boundedRead(manifestPath);
    const files = manifestFiles(manifest);
    const entries = new Map<string, Entry>();
    const add = (entry: Entry) => {
      const key = entry.key.toString("hex");
      if ((entries.get(key)?.sequence ?? -1n) < entry.sequence)
        entries.set(key, entry);
    };
    const names = await readdir(directory);
    const tableCache = new Map<string, { stamp: string; entries: Entry[] }>();
    for (const number of files.tables) {
      const base = String(number).padStart(6, "0");
      const path = join(
        directory,
        names.includes(`${base}.ldb`) ? `${base}.ldb` : `${base}.sst`,
      );
      const info = await stat(path);
      const stamp = `${info.ino}:${info.size}:${info.mtimeMs}`;
      const old = this.tables.get(path);
      const cached =
        old?.stamp === stamp
          ? old
          : { stamp, entries: tableEntries(await boundedRead(path)) };
      tableCache.set(path, cached);
      cached.entries.forEach(add);
    }
    for (const name of names) {
      if (!/^\d+\.log$/.test(name)) continue;
      const number = Number.parseInt(name, 10);
      if (number < files.log && number !== files.previousLog) continue;
      for (const record of logRecords(await boundedRead(join(directory, name))))
        for (const entry of writeBatch(record)) add(entry);
    }
    if (
      (await boundedRead(join(directory, "CURRENT"))).toString().trim() !==
        current ||
      !(await boundedRead(manifestPath)).equals(manifest)
    )
      throw new Error("LevelDB compacted during the read");
    this.tables = tableCache;
    return [...entries.values()].filter((entry) => entry.value !== null);
  }
}
