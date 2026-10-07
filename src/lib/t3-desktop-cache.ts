import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, posix, win32 } from "node:path";
import { BinaryReader, LevelDbReader, unsnappy } from "./leveldb-reader.js";
import type { AgentStatus, CodexThread } from "../types.js";

// T3 persists its shell (thread summaries) for every connection, including
// T3 Connect. Read only that store; never deserialize the auth/catalog stores.
// Chromium formats: content/browser/indexed_db/docs/leveldb_coding_scheme.md
// and third_party/blink/renderer/modules/indexeddb/idb_value_wrapping.cc.
const MAX_BYTES = 64 * 1024 * 1024;
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function utf16be(value: Buffer): string {
  return Buffer.from(value).swap16().toString("utf16le");
}
function wideString(reader: BinaryReader): string {
  return utf16be(reader.take(reader.varint() * 2));
}
function integer(value: Buffer): number {
  let n = 0;
  for (let i = 0; i < value.length; i++) n += value[i]! * 2 ** (8 * i);
  if (!Number.isSafeInteger(n)) throw new Error("Invalid IndexedDB ID");
  return n;
}
function prefix(key: Buffer) {
  const reader = new BinaryReader(key);
  const lengths = reader.byte();
  const database = integer(reader.take((lengths >> 5) + 1));
  const store = integer(reader.take(((lengths >> 2) & 7) + 1));
  const indexOffset = reader.offset;
  const index = integer(reader.take((lengths & 3) + 1));
  return { database, store, index, indexOffset, reader };
}

export function decodeIndexedDbString(raw: Buffer): string {
  if (raw[0] === 255 && raw[1] === 17 && raw[2] === 2)
    raw = unsnappy(raw.subarray(3));
  const reader = new BinaryReader(raw);
  if (reader.byte() !== 255) throw new Error("Invalid IndexedDB value");
  const blink = reader.varint();
  if (blink >= 21) {
    if (reader.byte() !== 254) throw new Error("Invalid IndexedDB trailer");
    reader.take(12); // trailer offset + size, unused for primitive strings
  }
  if (reader.byte() !== 255) throw new Error("Invalid V8 value");
  reader.varint(); // V8 versions differ between T3's Electron and plugin Node.
  while (raw[reader.offset] === 0) reader.byte();
  const tag = reader.byte();
  if (![34, 83, 99].includes(tag))
    throw new Error("Expected an IndexedDB string");
  const bytes = reader.bytes();
  if (tag === 99 && bytes.length % 2) throw new Error("Invalid UTF-16 string");
  return bytes.toString(
    tag === 99 ? "utf16le" : tag === 34 ? "latin1" : "utf8",
  );
}

async function readShellDocuments(directory: string, leveldb: LevelDbReader) {
  const records = await leveldb.read(directory);
  const databaseIds = new Set<number>();
  for (const { key, value } of records) {
    const p = prefix(key);
    if (p.database || p.store || p.index || p.reader.byte() !== 201) continue;
    wideString(p.reader); // origin
    if (wideString(p.reader) === "t3code:connection-runtime")
      databaseIds.add(integer(value!));
  }
  const stores = new Set<string>();
  for (const { key, value } of records) {
    const p = prefix(key);
    if (
      !databaseIds.has(p.database) ||
      p.store ||
      p.index ||
      p.reader.byte() !== 50
    )
      continue;
    const store = p.reader.varint();
    if (p.reader.byte() === 0 && utf16be(value!) === "shell")
      stores.add(`${p.database}:${store}`);
  }
  const byKey = new Map(
    records.map((entry) => [entry.key.toString("hex"), entry.value!]),
  );
  const documents = new Map<string, unknown>();
  for (const { key, value } of records) {
    const p = prefix(key);
    if (
      !stores.has(`${p.database}:${p.store}`) ||
      p.index !== 1 ||
      p.reader.byte() !== 1
    )
      continue;
    const environmentId = wideString(p.reader);
    const reader = new BinaryReader(value!);
    reader.varint(); // IndexedDB record version
    let raw = value!.subarray(reader.offset);
    if (raw[0] === 255 && raw[1] === 17 && raw[2] === 1) {
      const wrapper = new BinaryReader(raw.subarray(3));
      const size = wrapper.varint(),
        blobIndex = wrapper.varint();
      // The shell is a JSON string, so its sole external object is this blob.
      if (size > MAX_BYTES || blobIndex !== 0)
        throw new Error("Unsupported T3 shell blob");
      const externalKey = Buffer.from(key);
      externalKey.fill(0, p.indexOffset, p.indexOffset + (key[0]! & 3) + 1);
      externalKey[p.indexOffset] = 3;
      const metadata = byKey.get(externalKey.toString("hex"));
      if (!metadata) throw new Error("Missing T3 shell blob metadata");
      const blob = new BinaryReader(metadata);
      if (blob.byte() !== 0) throw new Error("Invalid T3 shell blob type");
      const number = blob.varint();
      wideString(blob); // MIME type
      if (blob.varint() !== size) throw new Error("Invalid T3 shell blob size");
      const path = join(
        directory.replace(/\.leveldb$/, ".blob"),
        p.database.toString(16),
        Math.floor(number / 256)
          .toString(16)
          .padStart(2, "0"),
        number.toString(16),
      );
      if ((await stat(path)).size !== size)
        throw new Error("T3 shell blob changed during read");
      raw = await readFile(path);
      if (raw.length !== size)
        throw new Error("T3 shell blob changed during read");
    }
    const document = object(JSON.parse(decodeIndexedDbString(raw)));
    if (
      document.schemaVersion !== 1 ||
      document.environmentId !== environmentId
    )
      throw new Error("Unsupported T3 shell cache");
    documents.set(environmentId, document.snapshot);
  }
  return documents;
}

function withinWorkspace(cwd: string, filter: string): boolean {
  const path = /^[a-z]:[\\/]|^\\\\/i.test(filter) ? win32 : posix;
  const child = path.relative(path.resolve(filter), path.resolve(cwd));
  return (
    child === "" ||
    (child !== ".." &&
      !child.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(child))
  );
}
function status(thread: Record<string, unknown>): AgentStatus {
  if (thread.hasPendingApprovals === true) return "awaiting-approval";
  if (thread.hasPendingUserInput === true) return "awaiting-response";
  const session = object(thread.session),
    turn = object(thread.latestTurn);
  if (
    ["starting", "running"].includes(String(session.status)) ||
    turn.state === "running"
  )
    return "working";
  if (
    session.status === "error" ||
    ["error", "failed"].includes(String(turn.state))
  )
    return "error";
  if (["working", "monitoring"].includes(String(thread.backgroundLiveness)))
    return "working";
  if (thread.hasActionableProposedPlan === true) return "awaiting-response";
  if (turn.state === "completed") return "unread";
  return "idle";
}

export function threadsFromT3Shell(
  snapshot: unknown,
  environmentId: string,
  cwdFilter?: string,
): CodexThread[] {
  const shell = object(snapshot);
  if (!Array.isArray(shell.projects) || !Array.isArray(shell.threads))
    throw new Error("Invalid T3 shell snapshot");
  const projects = new Map(
    shell.projects.map((p) => {
      const project = object(p);
      return [project.id, project];
    }),
  );
  return shell.threads
    .flatMap((value): CodexThread[] => {
      const thread = object(value),
        project = projects.get(thread.projectId);
      if (
        typeof thread.id !== "string" ||
        !project ||
        typeof project.workspaceRoot !== "string"
      )
        return [];
      if (
        thread.archivedAt ||
        thread.deletedAt ||
        project.deletedAt ||
        object(thread.lineage).relationshipToParent === "subagent"
      )
        return [];
      const cwd = project.workspaceRoot;
      if (
        cwdFilter &&
        !withinWorkspace(cwd, cwdFilter) &&
        !(
          typeof thread.worktreePath === "string" &&
          withinWorkspace(thread.worktreePath, cwdFilter)
        )
      )
        return [];
      return [
        {
          id: thread.id,
          t3ThreadRef: { threadId: thread.id, environmentId },
          title:
            typeof thread.title === "string" && thread.title
              ? thread.title
              : "Untitled thread",
          cwd,
          updatedAtMs: Math.max(
            Date.parse(String(thread.updatedAt)) || 0,
            Date.parse(String(object(thread.latestTurn).completedAt)) || 0,
          ),
          status: status(thread),
          rolloutPath: null,
          reasoningEffort: null,
          spawnStatus: null,
        },
      ];
    })
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.id.localeCompare(b.id))
    .slice(0, 20);
}

function cacheDirectories(): string[] {
  const appData =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return ["t3code", "T3 Code (Alpha)", "T3 Code (Nightly)", "T3 Code"].map(
    (name) =>
      join(appData, name, "IndexedDB", "t3code_app_0.indexeddb.leveldb"),
  );
}

export class T3DesktopCache {
  private readonly leveldb = new LevelDbReader();
  private cached:
    { expiresAt: number; documents: Promise<Map<string, unknown>> } | undefined;
  constructor(private readonly directories = cacheDirectories()) {}
  private async documents() {
    for (const directory of this.directories) {
      if (!isAbsolute(directory))
        throw new Error("T3 cache path must be absolute");
      try {
        await stat(join(directory, "CURRENT"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      return readShellDocuments(directory, this.leveldb);
    }
    throw new Error(
      "T3 desktop thread cache is unavailable; open T3 Code to synchronize T3 Connect threads",
    );
  }
  async read(
    environmentId: string,
    cwdFilter?: string,
  ): Promise<CodexThread[]> {
    if (!this.cached || this.cached.expiresAt <= Date.now()) {
      const cached = { expiresAt: Infinity, documents: this.documents() };
      this.cached = cached;
      void cached.documents.then(
        () => {
          cached.expiresAt = Date.now() + 1000;
        },
        () => {
          cached.expiresAt = Date.now() + 1000;
        },
      );
    }
    const snapshot = (await this.cached.documents).get(environmentId);
    if (!snapshot)
      throw new Error("T3 Connect thread cache is not synchronized");
    return threadsFromT3Shell(snapshot, environmentId, cwdFilter);
  }
}
