import { readFileSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  defaultCodexAppServer,
  type CodexAppServerClientLike,
  type CodexAppServerThread,
} from "./codex-app-server.js";
import { fastModeEnabledFromConfig } from "./fast-mode-config.js";
import {
  isWithinRemotePath,
  RemoteCodexStore,
  type RemoteFastModeState,
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
import type { CodexThread, RolloutRecord } from "../types.js";

type LocalStatusDescriptor = {
  appServerStatus: CodexThread["status"] | null;
  rolloutPath: string | null;
  spawnStatus: string | null;
};

type LocalSubtaskDescriptor = LocalStatusDescriptor;

type ThreadDescriptorBase = {
  id: string;
  title: string;
  cwd: string;
  updatedAtMs: number;
  recencyAtMs: number;
};

type LocalThreadDescriptor = ThreadDescriptorBase &
  LocalStatusDescriptor & {
    kind: "local";
    reasoningEffort: string | null;
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

type ReasoningRow = {
  id: string;
  model: string | null;
  reasoning_effort: string | null;
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
  selectionId: string;
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
) => Promise<RemoteFastModeState | null>;

export type CodexStoreOptions = {
  appServer?: CodexAppServerClientLike;
  codexHome?: string;
  readRemoteFastMode?: RemoteFastModeReader;
  readRemoteThreads?: RemoteThreadReader;
  readRolloutTail?: RolloutTailReader;
};

const THREAD_DESCRIPTORS_CACHE_MS = 1_000;
const defaultRemoteCodexStore = new RemoteCodexStore();

export class CodexStore {
  readonly codexHome: string;
  readonly sqliteHome: string;
  private readonly appServer: CodexAppServerClientLike;
  private readonly readRemoteFastMode: RemoteFastModeReader;
  private readonly readRemoteThreads: RemoteThreadReader;
  private readonly readRolloutTail: RolloutTailReader;

  constructor(options: CodexStoreOptions = {}) {
    const codexHome =
      options.codexHome ??
      (process.env.CODEX_HOME || join(homedir(), ".codex"));
    this.codexHome = codexHome;
    this.sqliteHome = resolveCodexSqliteHome(codexHome);
    this.readRolloutTail = options.readRolloutTail ?? readRolloutTailFromFile;
    this.readRemoteThreads =
      options.readRemoteThreads ?? defaultRemoteCodexStore.readThreadRows;
    this.readRemoteFastMode =
      options.readRemoteFastMode ?? defaultRemoteCodexStore.readFastModeState;
    this.appServer = options.appServer ?? defaultCodexAppServer;
  }

  private threadDescriptorsCache:
    | { descriptors: Promise<ThreadDescriptor[]>; expiresAtMs: number }
    | undefined;

  /** Invalidates cached local state and notifies actions on app-server events. */
  subscribe(listener: () => void): () => void {
    return this.appServer.subscribe((notification) => {
      if (!refreshesStoreState(notification.method)) return;
      this.threadDescriptorsCache = undefined;
      listener();
    });
  }

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
    const [localDescriptors, remoteRows] = await Promise.all([
      this.loadLocalThreadDescriptors(),
      this.readRemoteThreads(this.codexHome).catch(() => []),
    ]);
    const descriptorsById = new Map<string, ThreadDescriptor>();
    for (const descriptor of localDescriptors) {
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

  private async loadLocalThreadDescriptors(): Promise<LocalThreadDescriptor[]> {
    return localAppServerThreadDescriptors(await this.appServer.readThreads());
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

    const [status, subtaskStatuses] = await Promise.all([
      this.localStatus(descriptor),
      Promise.all(
        descriptor.subtasks.map((subtask) => this.localStatus(subtask)),
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
      status,
      subtaskStatuses,
    };
  }

  private async localStatus(
    descriptor: LocalStatusDescriptor,
  ): Promise<CodexThread["status"]> {
    if (
      descriptor.appServerStatus &&
      descriptor.appServerStatus !== "working"
    ) {
      return descriptor.appServerStatus;
    }
    const records = descriptor.rolloutPath
      ? await this.readRolloutTail(descriptor.rolloutPath)
      : [];
    const rolloutStatus = inferRolloutStatus(records, descriptor.spawnStatus);
    return descriptor.appServerStatus === "working" && rolloutStatus === "idle"
      ? "working"
      : rolloutStatus;
  }

  async fastModeEnabled(forceRemoteRefresh = false): Promise<boolean> {
    const states = await this.fastModeStates(forceRemoteRefresh);
    return states.remoteEnabled ?? states.localEnabled;
  }

  async fastModeStates(forceRemoteRefresh = false): Promise<FastModeStates> {
    const [localEnabled, remoteState] = await Promise.all([
      this.localFastModeEnabled(),
      this.readRemoteFastMode(this.codexHome, forceRemoteRefresh).catch(
        () => null,
      ),
    ]);
    return {
      localEnabled,
      remoteEnabled: remoteState?.enabled ?? null,
      selectionId: remoteState?.selectionId ?? "local",
    };
  }

  private async localFastModeEnabled(): Promise<boolean> {
    const config = await this.appServer.readConfig();
    const features = asObject(config.features);
    return fastModeEnabledFromConfig(config.service_tier, features?.fast_mode);
  }

  async planModeEnabled(): Promise<boolean> {
    const descriptor = (await this.loadLocalThreadDescriptors())[0];
    return descriptor?.rolloutPath
      ? planModeFromRollout(await this.readRolloutTail(descriptor.rolloutPath))
      : false;
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

    const efforts =
      (await this.appServer.readModels()).find(
        (candidate) => candidate.id === row.model,
      )?.reasoningEfforts ?? [];
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

function localAppServerThreadDescriptors(
  threads: readonly CodexAppServerThread[],
): LocalThreadDescriptor[] {
  const subtasksByParent = new Map<string, LocalSubtaskDescriptor[]>();
  for (const thread of threads) {
    if (!thread.parentThreadId) continue;
    const subtasks = subtasksByParent.get(thread.parentThreadId) ?? [];
    subtasks.push({
      appServerStatus: thread.status,
      rolloutPath: thread.rolloutPath,
      spawnStatus: null,
    });
    subtasksByParent.set(thread.parentThreadId, subtasks);
  }

  return threads.flatMap((thread) =>
    thread.parentThreadId
      ? []
      : [
          {
            appServerStatus: thread.status,
            cwd: thread.cwd,
            id: thread.id,
            kind: "local" as const,
            reasoningEffort: null,
            recencyAtMs: thread.recencyAtMs,
            rolloutPath: thread.rolloutPath,
            spawnStatus: null,
            subtasks: subtasksByParent.get(thread.id) ?? [],
            title: thread.title,
            updatedAtMs: thread.updatedAtMs,
          },
        ],
  );
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

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function refreshesStoreState(method: string): boolean {
  return (
    method === "fs/changed" ||
    method === "turn/started" ||
    method === "turn/completed" ||
    method === "thread/started" ||
    method === "thread/archived" ||
    method === "thread/deleted" ||
    method === "thread/unarchived" ||
    method === "thread/closed" ||
    method === "thread/reverted" ||
    method === "thread/compacted" ||
    method === "thread/queue/changed" ||
    method === "thread/status/changed" ||
    method === "thread/name/updated" ||
    method === "thread/settings/updated"
  );
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
