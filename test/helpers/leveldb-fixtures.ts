import { compress } from "snappyjs";
import { maskedCrc32c } from "../../src/lib/leveldb-reader.js";

export function vint(n: number): Buffer {
  const bytes = [];
  do {
    bytes.push((n % 128) | (n >= 128 ? 128 : 0));
    n = Math.floor(n / 128);
  } while (n);
  return Buffer.from(bytes);
}
export function bytes(b: Buffer): Buffer {
  return Buffer.concat([vint(b.length), b]);
}
export function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}
export function u64(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}
export function log(records: Buffer[]): Buffer {
  const chunks: Buffer[] = [];
  let length = 0;
  for (const record of records) {
    let offset = 0;
    do {
      let remaining = 32768 - (length % 32768);
      if (remaining < 7) {
        chunks.push(Buffer.alloc(remaining));
        length += remaining;
        remaining = 32768;
      }
      const size = Math.min(remaining - 7, record.length - offset);
      const last = offset + size === record.length;
      const type = offset === 0 ? (last ? 1 : 2) : last ? 4 : 3;
      const body = Buffer.concat([
        Buffer.from([type]),
        record.subarray(offset, offset + size),
      ]);
      const header = Buffer.alloc(6);
      header.writeUInt32LE(maskedCrc32c(body));
      header.writeUInt16LE(size, 4);
      chunks.push(header, body);
      length += size + 7;
      offset += size;
    } while (offset < record.length);
  }
  return Buffer.concat(chunks);
}
export type Pair = [Buffer, Buffer | null];
export function batch(sequence: number, pairs: Pair[]): Buffer {
  return Buffer.concat([
    u64(BigInt(sequence)),
    u32(pairs.length),
    ...pairs.flatMap(([key, value]) => [
      Buffer.from([value === null ? 0 : 1]),
      bytes(key),
      ...(value === null ? [] : [bytes(value)]),
    ]),
  ]);
}
export function manifest(tableNumbers: number[], logNumber = 3): Buffer {
  return log([
    Buffer.concat([
      vint(2),
      vint(logNumber),
      ...tableNumbers.flatMap((number) => [
        vint(7),
        vint(0),
        vint(number),
        vint(0),
        bytes(Buffer.alloc(0)),
        bytes(Buffer.alloc(0)),
      ]),
    ]),
  ]);
}
function block(pairs: [Buffer, Buffer][]): Buffer {
  let previous: Buffer = Buffer.alloc(0);
  return Buffer.concat([
    ...pairs.flatMap(([key, value]) => {
      let shared = 0;
      while (
        shared < Math.min(key.length, previous.length) &&
        key[shared] === previous[shared]
      )
        shared++;
      previous = key;
      return [
        vint(shared),
        vint(key.length - shared),
        vint(value.length),
        key.subarray(shared),
        value,
      ];
    }),
    u32(0),
    u32(1),
  ]);
}
function compressedBlock(data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(compress(data)), Buffer.from([1])]);
  return Buffer.concat([body, u32(maskedCrc32c(body))]);
}
export function table(sequence: number, pairs: Pair[]): Buffer {
  const data = compressedBlock(
    block(
      pairs.map(([key, value], i) => [
        Buffer.concat([
          key,
          u64((BigInt(sequence + i) << 8n) | (value === null ? 0n : 1n)),
        ]),
        value ?? Buffer.alloc(0),
      ]),
    ),
  );
  const index = compressedBlock(
    block([
      [Buffer.from("last"), Buffer.concat([vint(0), vint(data.length - 5)])],
    ]),
  );
  const footer = Buffer.alloc(48);
  Buffer.concat([
    vint(0),
    vint(0),
    vint(data.length),
    vint(index.length - 5),
  ]).copy(footer);
  footer.writeBigUInt64LE(0xdb4775248b80fb57n, 40);
  return Buffer.concat([data, index, footer]);
}
export function wide(value: string): Buffer {
  return Buffer.from(value, "utf16le").swap16();
}
export function wideString(value: string): Buffer {
  return Buffer.concat([vint(value.length), wide(value)]);
}
export function idbKey(store: number, key: string, index = 1): Buffer {
  return Buffer.concat([Buffer.from([0, 1, store, index, 1]), wideString(key)]);
}
export const shellMetadata: Pair[] = [
  [
    Buffer.concat([
      Buffer.from([0, 0, 0, 0, 201]),
      wideString("t3code_app_0@1"),
      wideString("t3code:connection-runtime"),
    ]),
    Buffer.from([1]),
  ],
  [Buffer.from([0, 1, 0, 0, 50, 2, 0]), wide("shell")],
];
export function stringValue(value: string, utf16 = false): Buffer {
  const body = Buffer.concat([
    Buffer.from([255, 21, 254]),
    Buffer.alloc(12),
    Buffer.from([255, 16, 0, utf16 ? 99 : 34]),
    bytes(Buffer.from(value, utf16 ? "utf16le" : "latin1")),
  ]);
  return Buffer.concat([
    vint(1),
    Buffer.from([255, 17, 2]),
    Buffer.from(compress(body)),
  ]);
}
