import { readFileSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { usageFromRollout } from "./codex-usage.js";
import {
  isWithinRemotePath,
  readRemoteThreadRows,
  type RemotePlatform,
  type RemoteThreadRow,
} from "./remote-codex-store.js";
import {
  inferRolloutStatus,
  parseRolloutLines,
  planModeFromRollout,
} from "./rollout-status.js";
import type {
  CodexThread,
  CodexUsageSnapshot,
  RolloutRecord,
} from "../types.js";

type LocalThreadRow = {
  id: string;
  title: string;
  cwd: string;
  rollout_path: string;
  updated_at_ms: number;
  reasoning_effort: string | null;
  spawn_status: string | null;
  recency_at_ms: number;
};

type ThreadDescriptor = {
  id: string;
  title: string;
  cwd: string;
  rolloutPath: string;
  updatedAtMs: number;
  reasoningEffort: string | null;
  spawnStatus: string | null;
  recencyAtMs: number;
  remoteHostId?: string;
  remotePlatform?: RemotePlatform;
  status?: CodexThread["status"];
};

type RolloutPathRow = {
  rollout_path: string;
};

type ReasoningRow = {
  id: string;
  model: string | null;
  reasoning_effort: string | null;
};

type ModelsCache = {
  models?: Array<{
    slug?: unknown;
    supported_reasoning_levels?: Array<{ effort?: unknown }>;
  }>;
};

export type ReasoningDirection = "increase" | "decrease";

export type ReasoningTarget = {
  changed: boolean;
  effort: string;
  optionIndex: number;
};

export type ReasoningSnapshot = {
  currentEffort: string;
  efforts: string[];
  model: string;
  threadId: string;
};

const TAIL_BYTES = 512 * 1024;

type RolloutTailReader = (path: string) => Promise<RolloutRecord[]>;
type RemoteThreadReader = (codexHome: string) => Promise<RemoteThreadRow[]>;

const THREAD_DESCRIPTORS_CACHE_MS = 1_000;

export class CodexStore {
  readonly codexHome: string;
  readonly sqliteHome: string;

  constructor(
    codexHome = process.env.CODEX_HOME || join(homedir(), ".codex"),
    private readonly readRolloutTail: RolloutTailReader = readRolloutTailFromFile,
    private readonly readRemoteThreads: RemoteThreadReader = readRemoteThreadRows,
  ) {
    this.codexHome = codexHome;
    this.sqliteHome = resolveCodexSqliteHome(codexHome);
  }

  private threadDescriptorsCache:
    | { descriptors: Promise<ThreadDescriptor[]>; expiresAtMs: number }
    | undefined;

  async recentThreads(limit = 12, cwdFilter?: string): Promise<CodexThread[]> {
    return Promise.all(
      (await this.recentThreadDescriptors(limit, cwdFilter)).map((descriptor) =>
        this.hydrateThread(descriptor),
      ),
    );
  }

  async threadAtSlot(
    slot: number,
    cwdFilter?: string,
  ): Promise<CodexThread | null> {
    const descriptor = (await this.recentThreadDescriptors(slot, cwdFilter))[
      slot - 1
    ];
    return descriptor ? this.hydrateThread(descriptor) : null;
  }

  async threadSearchResultIndex(
    threadId: string,
    title: string,
  ): Promise<number> {
    const searchKey = threadSearchKey(title);
    let resultIndex = 0;

    for (const descriptor of await this.allThreadDescriptors()) {
      if (descriptor.id === threadId) return resultIndex;
      if (threadSearchKey(descriptor.title || "Untitled task") === searchKey) {
        resultIndex += 1;
      }
    }

    throw new Error(`Codex task is no longer available: ${threadId}`);
  }

  private async recentThreadDescriptors(
    limit: number,
    cwdFilter?: string,
  ): Promise<ThreadDescriptor[]> {
    const rowLimit = Number.isFinite(limit)
      ? Math.max(0, Math.trunc(limit))
      : 0;
    if (rowLimit === 0) return [];
    const filter = cwdFilter?.trim() || null;
    const selected: ThreadDescriptor[] = [];

    for (const descriptor of await this.allThreadDescriptors()) {
      if (filter && !matchesWorkspaceFilter(descriptor, filter)) continue;
      selected.push(descriptor);
      if (selected.length === rowLimit) break;
    }
    return selected;
  }

  private allThreadDescriptors(): Promise<ThreadDescriptor[]> {
    const now = Date.now();
    if (
      this.threadDescriptorsCache &&
      this.threadDescriptorsCache.expiresAtMs > now
    ) {
      return this.threadDescriptorsCache.descriptors;
    }

    const descriptors = this.loadThreadDescriptors();
    const cache = {
      descriptors,
      expiresAtMs: Number.POSITIVE_INFINITY,
    };
    this.threadDescriptorsCache = cache;
    void descriptors.then(
      () => {
        if (this.threadDescriptorsCache === cache) {
          cache.expiresAtMs = Date.now() + THREAD_DESCRIPTORS_CACHE_MS;
        }
      },
      () => {
        if (this.threadDescriptorsCache === cache) {
          this.threadDescriptorsCache = undefined;
        }
      },
    );
    return descriptors;
  }

  private async loadThreadDescriptors(): Promise<ThreadDescriptor[]> {
    const localRows = this.withDatabase((db) => {
      const statement = db.prepare(
        `SELECT t.id, t.title, t.cwd, t.rollout_path,
                COALESCE(t.updated_at_ms, t.updated_at * 1000) AS updated_at_ms,
                t.recency_at_ms,
                t.reasoning_effort,
                e.status AS spawn_status
           FROM threads t
      LEFT JOIN thread_spawn_edges e ON e.child_thread_id = t.id
          WHERE t.archived = 0 AND t.preview <> ''
       ORDER BY t.recency_at_ms DESC, t.id DESC`,
      );
      return [...(statement.iterate() as unknown as Iterable<LocalThreadRow>)];
    });

    const remoteRows = await this.readRemoteThreads(this.codexHome).catch(
      () => [],
    );
    const descriptorsById = new Map<string, ThreadDescriptor>();
    for (const row of localRows) {
      const descriptor = localThreadDescriptor(row);
      descriptorsById.set(descriptor.id, descriptor);
    }
    for (const row of remoteRows) {
      descriptorsById.set(row.id, remoteThreadDescriptor(row));
    }
    return [...descriptorsById.values()].sort(
      (left, right) =>
        right.recencyAtMs - left.recencyAtMs || right.id.localeCompare(left.id),
    );
  }

  private async hydrateThread(
    descriptor: ThreadDescriptor,
  ): Promise<CodexThread> {
    return {
      id: descriptor.id,
      title: descriptor.title || "Untitled task",
      cwd: descriptor.cwd,
      rolloutPath: descriptor.rolloutPath,
      remoteHostId: descriptor.remoteHostId,
      updatedAtMs: Number(descriptor.updatedAtMs) || 0,
      reasoningEffort: descriptor.reasoningEffort,
      spawnStatus: descriptor.spawnStatus,
      status:
        descriptor.status ??
        inferRolloutStatus(
          await this.readRolloutTail(descriptor.rolloutPath),
          descriptor.spawnStatus,
        ),
    };
  }

  async latestUsage(limit = 12): Promise<CodexUsageSnapshot | null> {
    const rows = this.withDatabase(
      (db) =>
        db
          .prepare(
            `SELECT rollout_path
             FROM threads
            WHERE rollout_path <> ''
         ORDER BY recency_at_ms DESC, id DESC
            LIMIT ?`,
          )
          .all(Math.max(1, limit)) as unknown as RolloutPathRow[],
    );

    const snapshots = await Promise.all(
      rows.map(async (row) =>
        usageFromRollout(await this.readRolloutTail(row.rollout_path)),
      ),
    );
    return (
      snapshots
        .filter((snapshot): snapshot is CodexUsageSnapshot => snapshot !== null)
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs)[0] ?? null
    );
  }

  async fastModeEnabled(): Promise<boolean> {
    let config: string;
    try {
      config = await readFile(join(this.codexHome, "config.toml"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }

    const serviceTier = readRootTomlString(config, "service_tier");
    const featureEnabled = readTomlBoolean(config, "features", "fast_mode");
    // Codex CLI documents "fast"; the desktop app currently persists the same mode as
    // "priority". Accept both representations so the Stream Deck state follows either surface.
    return (
      (serviceTier === "fast" || serviceTier === "priority") &&
      featureEnabled !== false
    );
  }

  async planModeEnabled(): Promise<boolean> {
    const row = this.withDatabase(
      (db) =>
        db
          .prepare(
            `SELECT rollout_path
             FROM threads
            WHERE archived = 0 AND preview <> ''
         ORDER BY recency_at_ms DESC, id DESC
            LIMIT 1`,
          )
          .get() as RolloutPathRow | undefined,
    );
    if (!row) return false;
    return planModeFromRollout(await this.readRolloutTail(row.rollout_path));
  }

  async reasoningSnapshot(): Promise<ReasoningSnapshot> {
    const row = this.withDatabase(
      (db) =>
        db
          .prepare(
            `SELECT id, model, reasoning_effort
             FROM threads
            WHERE archived = 0
         ORDER BY recency_at_ms DESC, id DESC
            LIMIT 1`,
          )
          .get() as ReasoningRow | undefined,
    );

    if (!row?.model || !row.reasoning_effort) {
      throw new Error("The current Codex task has no reasoning setting");
    }

    const cache = JSON.parse(
      await readFile(join(this.codexHome, "models_cache.json"), "utf8"),
    ) as ModelsCache;
    const model = cache.models?.find(
      (candidate) => candidate.slug === row.model,
    );
    const efforts = (model?.supported_reasoning_levels ?? [])
      .map((level) => level.effort)
      .filter(
        (effort): effort is string =>
          typeof effort === "string" && effort.length > 0,
      );
    if (!efforts.includes(row.reasoning_effort)) {
      throw new Error(
        `Unsupported reasoning effort for ${row.model}: ${row.reasoning_effort}`,
      );
    }

    return {
      currentEffort: row.reasoning_effort,
      efforts,
      model: row.model,
      threadId: row.id,
    };
  }

  async reasoningTarget(
    direction: ReasoningDirection,
    steps = 1,
  ): Promise<ReasoningTarget> {
    const snapshot = await this.reasoningSnapshot();
    const currentIndex = snapshot.efforts.indexOf(snapshot.currentEffort);
    const optionIndex = reasoningTargetIndex(
      snapshot.efforts,
      snapshot.currentEffort,
      direction,
      steps,
    );
    return {
      changed: optionIndex !== currentIndex,
      effort: snapshot.efforts[optionIndex]!,
      optionIndex,
    };
  }

  private withDatabase<T>(read: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(join(this.sqliteHome, "state_5.sqlite"), {
      readOnly: true,
    });
    try {
      return read(db);
    } finally {
      db.close();
    }
  }
}

function localThreadDescriptor(row: LocalThreadRow): ThreadDescriptor {
  return {
    cwd: row.cwd,
    id: row.id,
    reasoningEffort: row.reasoning_effort,
    recencyAtMs: row.recency_at_ms,
    rolloutPath: row.rollout_path,
    spawnStatus: row.spawn_status,
    title: row.title,
    updatedAtMs: row.updated_at_ms,
  };
}

function remoteThreadDescriptor(row: RemoteThreadRow): ThreadDescriptor {
  return {
    ...row,
    reasoningEffort: null,
    spawnStatus: null,
  };
}

export function normalizeThreadSearchQuery(title: string): string {
  const clean = title.trim().replace(/\s+/gu, " ").slice(0, 200);
  if (!clean) throw new Error("Thread title is required for task search");
  return clean;
}

function threadSearchKey(title: string): string {
  return normalizeThreadSearchQuery(title).toLocaleLowerCase();
}

export function resolveCodexSqliteHome(
  codexHome: string,
  sqliteHomeEnvironment = process.env.CODEX_SQLITE_HOME,
  cwd = process.cwd(),
): string {
  const configuredHome = readSqliteHomeSetting(join(codexHome, "config.toml"));
  return resolve(cwd, configuredHome || sqliteHomeEnvironment || codexHome);
}

function readSqliteHomeSetting(configPath: string): string | undefined {
  let config: string;
  try {
    config = readFileSync(configPath, "utf8");
  } catch {
    return undefined;
  }

  return readRootTomlString(config, "sqlite_home");
}

function readRootTomlString(config: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const assignmentPattern = new RegExp(
    `^(?:${escapedKey}|"${escapedKey}"|'${escapedKey}')\\s*=\\s*(.*)$`,
    "u",
  );

  for (const line of config.split(/\r?\n/u)) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) return undefined;

    const assignment = assignmentPattern.exec(trimmed);
    if (!assignment) continue;
    return parseTomlString(assignment[1]!);
  }

  return undefined;
}

function readTomlBoolean(
  config: string,
  table: string,
  key: string,
): boolean | undefined {
  const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const tablePattern = new RegExp(
    `^\\[\\s*(?:${escapedTable}|"${escapedTable}"|'${escapedTable}')\\s*\\](?:\\s*#.*)?$`,
    "u",
  );
  const assignmentPattern = new RegExp(
    `^(?:${escapedKey}|"${escapedKey}"|'${escapedKey}')\\s*=\\s*(true|false)(?:\\s*#.*)?$`,
    "u",
  );
  let inTable = false;

  for (const line of config.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      inTable = tablePattern.test(trimmed);
      continue;
    }
    if (!inTable) continue;

    const assignment = assignmentPattern.exec(trimmed);
    if (assignment) return assignment[1] === "true";
  }

  return undefined;
}

function parseTomlString(value: string): string | undefined {
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return undefined;

  let parsed = "";
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === quote) {
      const trailing = value.slice(index + 1).trimStart();
      return !trailing || trailing.startsWith("#") ? parsed : undefined;
    }
    if (quote === "'" || character !== "\\") {
      parsed += character;
      continue;
    }

    const escape = value[++index];
    const simpleEscape = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      '"': '"',
      "\\": "\\",
    }[escape ?? ""];
    if (simpleEscape !== undefined) {
      parsed += simpleEscape;
      continue;
    }

    const digits = escape === "u" ? 4 : escape === "U" ? 8 : 0;
    const codePoint = value.slice(index + 1, index + 1 + digits);
    if (
      !digits ||
      !new RegExp(`^[0-9a-fA-F]{${digits}}$`, "u").test(codePoint)
    ) {
      return undefined;
    }
    try {
      parsed += String.fromCodePoint(Number.parseInt(codePoint, 16));
    } catch {
      return undefined;
    }
    index += digits;
  }

  return undefined;
}

async function readRolloutTailFromFile(path: string): Promise<RolloutRecord[]> {
  try {
    const info = await stat(path);
    const length = Math.min(info.size, TAIL_BYTES);
    const start = Math.max(0, info.size - length);
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return parseRolloutLines(buffer.subarray(0, bytesRead).toString("utf8"));
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }
}

export function reasoningTargetIndex(
  efforts: readonly string[],
  currentEffort: string,
  direction: ReasoningDirection,
  steps = 1,
): number {
  const currentIndex = efforts.indexOf(currentEffort);
  if (currentIndex < 0)
    throw new Error(`Unknown reasoning effort: ${currentEffort}`);
  const distance = Math.max(1, Math.trunc(Math.abs(steps)) || 1);
  const delta = direction === "increase" ? distance : -distance;
  return Math.min(efforts.length - 1, Math.max(0, currentIndex + delta));
}

function matchesWorkspaceFilter(
  descriptor: ThreadDescriptor,
  filter: string,
): boolean {
  if (descriptor.remoteHostId) {
    return isWithinRemotePath(
      descriptor.cwd,
      filter,
      descriptor.remotePlatform ?? "posix",
    );
  }

  const normalizedFilter = resolve(filter);
  const cwd = resolve(descriptor.cwd);
  return (
    cwd === normalizedFilter || cwd.startsWith(`${normalizedFilter}${sep}`)
  );
}
