import { readFileSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { usageFromRollout } from "./codex-usage.js";
import {
  isWithinRemotePath,
  RemoteCodexStore,
  type RemotePlatform,
  type RemoteThreadRow,
} from "./remote-codex-store.js";
import {
  hasPendingEscalatedToolCall,
  inferRolloutStatus,
  latestApprovalContext,
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

type LocalSubtaskRow = {
  parent_thread_id: string;
  rollout_path: string;
  status: string;
};

type LocalSubtaskDescriptor = {
  rolloutPath: string;
  spawnStatus: string;
};

type ThreadDescriptorBase = {
  id: string;
  title: string;
  cwd: string;
  updatedAtMs: number;
  recencyAtMs: number;
};

type LocalThreadDescriptor = ThreadDescriptorBase & {
  kind: "local";
  reasoningEffort: string | null;
  rolloutPath: string;
  spawnStatus: string | null;
  subtasks: LocalSubtaskDescriptor[];
};

type RemoteThreadDescriptor = ThreadDescriptorBase & {
  kind: "remote";
  remoteHostId: string;
  remotePlatform: RemotePlatform;
  rolloutPath: string | null;
  status: CodexThread["status"];
  subtaskStatuses?: CodexThread["subtaskStatuses"];
};

type ThreadDescriptor = LocalThreadDescriptor | RemoteThreadDescriptor;

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

export type FastModeStates = {
  localEnabled: boolean;
  remoteEnabled: boolean | null;
};

const TAIL_BYTES = 512 * 1024;
const APPROVAL_CONTEXT_CACHE_LIMIT = 100;

type ApprovalContextCacheEntry = {
  fileSize: number;
  record: RolloutRecord;
};

const approvalContextCache = new Map<string, ApprovalContextCacheEntry>();

type RolloutTailReader = (path: string) => Promise<RolloutRecord[]>;
type RemoteThreadReader = (codexHome: string) => Promise<RemoteThreadRow[]>;
type RemoteFastModeReader = (
  codexHome: string,
  forceRefresh?: boolean,
) => Promise<boolean | null>;

const THREAD_DESCRIPTORS_CACHE_MS = 1_000;
const defaultRemoteCodexStore = new RemoteCodexStore();

export class CodexStore {
  readonly codexHome: string;
  readonly sqliteHome: string;

  constructor(
    codexHome = process.env.CODEX_HOME || join(homedir(), ".codex"),
    private readonly readRolloutTail: RolloutTailReader = readRolloutTailFromFile,
    private readonly readRemoteThreads: RemoteThreadReader = defaultRemoteCodexStore.readThreadRows,
    private readonly readRemoteFastMode: RemoteFastModeReader = defaultRemoteCodexStore.readFastModeEnabled,
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

  async threadSearchResult(
    threadId: string,
  ): Promise<{ resultIndex: number; title: string }> {
    const descriptors = await this.allThreadDescriptors();
    const selected = descriptors.find(
      (descriptor) => descriptor.id === threadId,
    );
    if (!selected) {
      throw new Error(`Codex chat is no longer available: ${threadId}`);
    }

    const title = selected.title || "Untitled chat";
    const searchKey = threadSearchKey(title);
    let resultIndex = 0;

    for (const descriptor of descriptors) {
      if (descriptor.id === threadId) return { resultIndex, title };
      if (threadSearchKey(descriptor.title || "Untitled chat") === searchKey) {
        resultIndex += 1;
      }
    }

    throw new Error(`Codex chat ordering changed while selecting: ${threadId}`);
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
    const { localRows, localSubtaskRows } = this.withDatabase((db) => {
      const statement = db.prepare(
        `SELECT t.id, t.title, t.cwd, t.rollout_path,
                COALESCE(t.updated_at_ms, t.updated_at * 1000) AS updated_at_ms,
                t.recency_at_ms,
                t.reasoning_effort,
                NULL AS spawn_status
           FROM threads t
          WHERE t.archived = 0 AND t.preview <> ''
            AND NOT EXISTS (
                  SELECT 1
                    FROM thread_spawn_edges e
                   WHERE e.child_thread_id = t.id
                )
       ORDER BY t.recency_at_ms DESC, t.id DESC`,
      );
      const subtaskStatement = db.prepare(
        `SELECT e.parent_thread_id, t.rollout_path, e.status
           FROM thread_spawn_edges e
           JOIN threads t ON t.id = e.child_thread_id
       ORDER BY e.parent_thread_id, e.child_thread_id`,
      );
      return {
        localRows: [
          ...(statement.iterate() as unknown as Iterable<LocalThreadRow>),
        ],
        localSubtaskRows: [
          ...(subtaskStatement.iterate() as unknown as Iterable<LocalSubtaskRow>),
        ],
      };
    });

    const remoteRows = await this.readRemoteThreads(this.codexHome).catch(
      () => [],
    );
    const descriptorsById = new Map<string, ThreadDescriptor>();
    const localSubtasksByParent = new Map<string, LocalSubtaskDescriptor[]>();
    for (const row of localSubtaskRows) {
      const subtasks = localSubtasksByParent.get(row.parent_thread_id) ?? [];
      subtasks.push({
        rolloutPath: row.rollout_path,
        spawnStatus: row.status,
      });
      localSubtasksByParent.set(row.parent_thread_id, subtasks);
    }
    for (const row of localRows) {
      const descriptor = localThreadDescriptor(
        row,
        localSubtasksByParent.get(row.id) ?? [],
      );
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
    if (descriptor.kind === "remote") {
      return {
        id: descriptor.id,
        title: descriptor.title || "Untitled chat",
        cwd: descriptor.cwd,
        rolloutPath: descriptor.rolloutPath,
        remoteHostId: descriptor.remoteHostId,
        updatedAtMs: Number(descriptor.updatedAtMs) || 0,
        reasoningEffort: null,
        spawnStatus: null,
        status: descriptor.status,
        subtaskStatuses: descriptor.subtaskStatuses,
      };
    }

    const [records, subtaskStatuses] = await Promise.all([
      this.readRolloutTail(descriptor.rolloutPath),
      Promise.all(
        descriptor.subtasks.map(async (subtask) =>
          inferRolloutStatus(
            await this.readRolloutTail(subtask.rolloutPath),
            subtask.spawnStatus,
          ),
        ),
      ),
    ]);
    return {
      id: descriptor.id,
      title: descriptor.title || "Untitled chat",
      cwd: descriptor.cwd,
      rolloutPath: descriptor.rolloutPath,
      updatedAtMs: Number(descriptor.updatedAtMs) || 0,
      reasoningEffort: descriptor.reasoningEffort,
      spawnStatus: descriptor.spawnStatus,
      status: inferRolloutStatus(records, descriptor.spawnStatus),
      subtaskStatuses,
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

  async fastModeEnabled(forceRemoteRefresh = false): Promise<boolean> {
    const states = await this.fastModeStates(forceRemoteRefresh);
    return states.remoteEnabled ?? states.localEnabled;
  }

  async fastModeStates(forceRemoteRefresh = false): Promise<FastModeStates> {
    const [localEnabled, remoteEnabled] = await Promise.all([
      this.localFastModeEnabled(),
      this.readRemoteFastMode(this.codexHome, forceRemoteRefresh).catch(
        () => null,
      ),
    ]);
    return { localEnabled, remoteEnabled };
  }

  private async localFastModeEnabled(): Promise<boolean> {
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
      throw new Error("The current Codex chat has no reasoning setting");
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

function localThreadDescriptor(
  row: LocalThreadRow,
  subtasks: LocalSubtaskDescriptor[],
): LocalThreadDescriptor {
  return {
    cwd: row.cwd,
    id: row.id,
    kind: "local",
    reasoningEffort: row.reasoning_effort,
    recencyAtMs: row.recency_at_ms,
    rolloutPath: row.rollout_path,
    spawnStatus: row.spawn_status,
    subtasks,
    title: row.title,
    updatedAtMs: row.updated_at_ms,
  };
}

function remoteThreadDescriptor(row: RemoteThreadRow): RemoteThreadDescriptor {
  return {
    ...row,
    kind: "remote",
  };
}

export function normalizeThreadSearchQuery(title: string): string {
  const clean = title.trim().replace(/\s+/gu, " ").slice(0, 200);
  if (!clean) throw new Error("Thread title is required for chat search");
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
    const handle = await open(path, "r");
    try {
      const records = await readRolloutWindow(handle, info.size, length);
      const visibleContext = latestApprovalContext(records);
      if (visibleContext) {
        rememberApprovalContext(path, info.size, visibleContext);
        return records;
      }

      const cached = approvalContextCache.get(path);
      if (cached && info.size < cached.fileSize)
        approvalContextCache.delete(path);
      const retainedContext = approvalContextCache.get(path)?.record;
      if (!hasPendingEscalatedToolCall(records)) return records;
      if (retainedContext) {
        rememberApprovalContext(path, info.size, retainedContext);
        return [retainedContext, ...records];
      }

      let contextWindowLength = length;
      while (contextWindowLength < info.size) {
        contextWindowLength = Math.min(info.size, contextWindowLength * 2);
        const contextRecords = await readRolloutWindow(
          handle,
          info.size,
          contextWindowLength,
        );
        const recoveredContext = latestApprovalContext(contextRecords);
        if (recoveredContext) {
          rememberApprovalContext(path, info.size, recoveredContext);
          return [recoveredContext, ...records];
        }
      }
      return records;
    } finally {
      await handle.close();
    }
  } catch {
    return [];
  }
}

async function readRolloutWindow(
  handle: Awaited<ReturnType<typeof open>>,
  fileSize: number,
  length: number,
): Promise<RolloutRecord[]> {
  const start = Math.max(0, fileSize - length);
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, start);
  return parseRolloutLines(buffer.subarray(0, bytesRead).toString("utf8"));
}

function rememberApprovalContext(
  path: string,
  fileSize: number,
  record: RolloutRecord,
): void {
  approvalContextCache.delete(path);
  approvalContextCache.set(path, { fileSize, record });
  while (approvalContextCache.size > APPROVAL_CONTEXT_CACHE_LIMIT) {
    const oldestPath = approvalContextCache.keys().next().value;
    if (typeof oldestPath !== "string") break;
    approvalContextCache.delete(oldestPath);
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
  if (descriptor.kind === "remote") {
    return isWithinRemotePath(
      descriptor.cwd,
      filter,
      descriptor.remotePlatform,
    );
  }

  const normalizedFilter = resolve(filter);
  const cwd = resolve(descriptor.cwd);
  return (
    cwd === normalizedFilter || cwd.startsWith(`${normalizedFilter}${sep}`)
  );
}
