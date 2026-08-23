import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import { createInterface, type Interface } from "node:readline";
import { MAX_AGENT_SLOTS } from "./agent-slots.js";
import { fastModeEnabledFromConfig } from "./fast-mode-config.js";
import { inferRolloutStatus, parseRolloutLines } from "./rollout-status.js";
import type { AgentStatus, RolloutRecord } from "../types.js";

const APP_SERVER_TIMEOUT_MS = 8_000;
const INITIAL_HOST_WAIT_MS = 500;
const INITIAL_HOST_SETTLE_MS = 25;
const REMOTE_FAST_MODE_CACHE_MS = 2_000;
const REMOTE_HOST_CACHE_MS = 1_000;
const REMOTE_ROLLOUT_TAIL_BYTES = 512 * 1024;
const THREADS_PER_PAGE = 100;

type JsonObject = Record<string, unknown>;

export type RemotePlatform = "posix" | "windows";

export type RemoteConnection = {
  destination: string;
  hostId: string;
  identity?: string;
  port?: number;
};

type AppServerThreadStatus = {
  activeFlags?: unknown;
  type?: unknown;
};

type AppServerThread = {
  cwd?: unknown;
  id?: unknown;
  name?: unknown;
  parentThreadId?: unknown;
  path?: unknown;
  preview?: unknown;
  recencyAt?: unknown;
  source?: unknown;
  status?: AppServerThreadStatus;
  updatedAt?: unknown;
};

type AppServerTurn = {
  items?: unknown;
  status?: unknown;
};

export type RemoteThreadRow = {
  cwd: string;
  id: string;
  recencyAtMs: number;
  remoteHostId: string;
  remotePlatform: RemotePlatform;
  rolloutPath: string | null;
  status: AgentStatus;
  subtaskStatuses?: AgentStatus[];
  title: string;
  updatedAtMs: number;
};

export type RemoteHostThreadReader = (
  connection: RemoteConnection,
  projectPaths: readonly string[],
) => Promise<RemoteThreadRow[]>;

export type RemoteHostFastModeReader = (
  connection: RemoteConnection,
) => Promise<boolean>;

export type RemoteFastModeState = {
  enabled: boolean;
  selectionId: string;
};

export type RemoteHostFailure = {
  atMs: number;
  hostId: string;
  kind: "protocol" | "rollout" | "timeout" | "transport";
  message: string;
};

type RemoteProjectGroup = {
  connection: RemoteConnection;
  paths: Set<string>;
};

type RemoteHostCacheEntry = {
  expiresAtMs: number;
  failure?: RemoteHostFailure;
  hasValue: boolean;
  refresh?: Promise<void>;
  rows: RemoteThreadRow[];
  signature: string;
};

type RemoteFastModeCacheEntry = {
  expiresAtMs: number;
  refresh?: Promise<boolean>;
  signature: string;
  value?: boolean;
};

export type RemoteRolloutTailReader = (
  connection: RemoteConnection,
  rolloutPaths: readonly string[],
  sshCommand: string,
  platform: RemotePlatform,
) => Promise<Map<string, RolloutRecord[]>>;

class RemoteReadError extends Error {
  constructor(
    readonly kind: RemoteHostFailure["kind"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RemoteReadError";
  }
}

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (message: JsonObject) => void;
};

class AppServerSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private readonly timeout: NodeJS.Timeout;
  private closed = false;
  private nextRequestId = 0;
  private stderr = "";
  private terminalError: Error | null = null;

  constructor(
    private readonly connection: RemoteConnection,
    sshCommand: string,
  ) {
    this.child = spawn(
      sshCommand,
      sshArguments(connection, ["codex", "app-server"]),
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      if (this.stderr.length < 8_192) {
        this.stderr += chunk.slice(0, 8_192 - this.stderr.length);
      }
    });

    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stdin.on("error", (error) => {
      this.fail(
        new RemoteReadError(
          "transport",
          `Codex app-server stdin failed for ${connection.hostId}: ${error.message}`,
          { cause: error },
        ),
      );
    });
    this.child.once("error", (error) => {
      this.fail(
        new RemoteReadError(
          "transport",
          `Failed to start SSH for ${connection.hostId}: ${error.message}`,
          { cause: error },
        ),
      );
    });
    this.child.once("close", (code) => {
      const detail = this.stderr.trim();
      this.fail(
        new RemoteReadError(
          "transport",
          `Codex app-server for ${connection.hostId} exited with code ${code}${
            detail ? `: ${detail}` : ""
          }`,
        ),
      );
    });

    this.timeout = setTimeout(() => {
      this.fail(
        new RemoteReadError(
          "timeout",
          `Timed out reading Codex chats from ${connection.hostId}`,
        ),
      );
    }, APP_SERVER_TIMEOUT_MS);
    this.timeout.unref();
  }

  request(method: string, params: JsonObject): Promise<JsonObject> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.closed) {
      return Promise.reject(
        new RemoteReadError(
          "transport",
          `Codex app-server session closed for ${this.connection.hostId}`,
        ),
      );
    }

    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { reject, resolve });
      this.send({ id, method, params });
    });
  }

  notify(method: string, params: JsonObject): void {
    this.send({ method, params });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.cleanup();
    const error = new RemoteReadError(
      "transport",
      `Codex app-server session closed for ${this.connection.hostId}`,
    );
    for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();
  }

  private handleLine(line: string): void {
    if (this.closed || !line.trim()) return;

    let message: JsonObject;
    try {
      const decoded = JSON.parse(line) as unknown;
      const object = asObject(decoded);
      if (!object) throw new Error("message is not an object");
      message = object;
    } catch (error) {
      this.fail(
        new RemoteReadError(
          "protocol",
          `Invalid JSON-RPC message from ${this.connection.hostId}`,
          { cause: error },
        ),
      );
      return;
    }

    if (message.error !== undefined) {
      this.fail(jsonRpcResponseError(this.connection.hostId, message));
      return;
    }
    if (typeof message.id !== "number") return;

    const pending = this.pendingRequests.get(message.id);
    if (!pending) return;
    this.pendingRequests.delete(message.id);
    pending.resolve(message);
  }

  private send(message: JsonObject): void {
    if (
      this.closed ||
      this.child.stdin.destroyed ||
      this.child.stdin.writableEnded ||
      !this.child.stdin.writable
    ) {
      this.fail(
        new RemoteReadError(
          "transport",
          `Codex app-server stdin closed for ${this.connection.hostId}`,
        ),
      );
      return;
    }

    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          this.fail(
            new RemoteReadError(
              "transport",
              `Failed to write to Codex app-server on ${this.connection.hostId}: ${error.message}`,
              { cause: error },
            ),
          );
        }
      });
    } catch (error) {
      this.fail(
        new RemoteReadError(
          "transport",
          `Failed to write to Codex app-server on ${this.connection.hostId}`,
          { cause: error },
        ),
      );
    }
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.terminalError = error;
    this.cleanup();
    for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();
  }

  private cleanup(): void {
    clearTimeout(this.timeout);
    this.lines.close();
    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
      this.child.stdin.end();
    }
    if (this.child.exitCode === null) this.child.kill();
  }
}

export class RemoteCodexStore {
  private readonly fastModeCache = new Map<string, RemoteFastModeCacheEntry>();
  private readonly hostCache = new Map<string, RemoteHostCacheEntry>();

  constructor(
    private readonly readHostThreads: RemoteHostThreadReader = readThreadsFromHost,
    private readonly readHostFastMode: RemoteHostFastModeReader = readFastModeFromHost,
  ) {}

  /** Reads Fast mode from the host backing the desktop app's selected project. */
  readonly readFastModeState = async (
    codexHome: string,
    forceRefresh = false,
  ): Promise<RemoteFastModeState | null> => {
    const state = await readGlobalState(codexHome);
    const selected = selectedRemoteConnection(state);
    if (!selected.isRemote) return null;
    if (!selected.connection) {
      throw new RemoteReadError(
        "transport",
        "The selected Codex remote project has no configured SSH connection",
      );
    }

    const { connection, selectionId } = selected;
    const key = remoteHostCacheKey(codexHome, connection.hostId);
    const signature = JSON.stringify(connection);
    let entry = this.fastModeCache.get(key);
    if (!entry || entry.signature !== signature) {
      entry = { expiresAtMs: 0, signature };
      this.fastModeCache.set(key, entry);
    }
    if (entry.refresh) {
      return { enabled: await entry.refresh, selectionId };
    }
    if (
      !forceRefresh &&
      entry.value !== undefined &&
      entry.expiresAtMs > Date.now()
    ) {
      return { enabled: entry.value, selectionId };
    }

    const refresh = this.readHostFastMode(connection);
    entry.refresh = refresh;
    try {
      const value = await refresh;
      if (this.fastModeCache.get(key) === entry) {
        entry.value = value;
        entry.expiresAtMs = Date.now() + REMOTE_FAST_MODE_CACHE_MS;
      }
      return { enabled: value, selectionId };
    } finally {
      if (this.fastModeCache.get(key) === entry) entry.refresh = undefined;
    }
  };

  /**
   * Reads SSH projects saved by the desktop app and asks each host's Codex app
   * server for its recent chats. Host results use stale-while-revalidate caching,
   * so an unavailable host cannot delay local or healthy-host chat discovery.
   */
  readonly readThreadRows = async (
    codexHome: string,
  ): Promise<RemoteThreadRow[]> => {
    const state = await readGlobalState(codexHome);
    if (state === null) return [];

    const groups = remoteProjectGroups(state);
    const activeKeys = new Set<string>();
    const initialRefreshes: Promise<void>[] = [];

    for (const { connection, paths } of groups.values()) {
      const key = remoteHostCacheKey(codexHome, connection.hostId);
      activeKeys.add(key);
      const normalizedPaths = [...paths].sort();
      const signature = JSON.stringify([connection, normalizedPaths]);
      let entry = this.hostCache.get(key);
      if (!entry || entry.signature !== signature) {
        entry = {
          expiresAtMs: 0,
          hasValue: false,
          rows: [],
          signature,
        };
        this.hostCache.set(key, entry);
      }

      if (!entry.refresh && entry.expiresAtMs <= Date.now()) {
        const wasEmpty = !entry.hasValue;
        entry.refresh = refreshRemoteHost(
          entry,
          connection,
          normalizedPaths,
          this.readHostThreads,
        );
        if (wasEmpty) initialRefreshes.push(entry.refresh);
      }
    }

    for (const key of this.hostCache.keys()) {
      if (key.startsWith(`${codexHome}\0`) && !activeKeys.has(key)) {
        this.hostCache.delete(key);
      }
    }

    if (initialRefreshes.length > 0) {
      const firstSettled = Promise.race(initialRefreshes);
      await Promise.race([
        Promise.allSettled(initialRefreshes),
        firstSettled.then(() => delay(INITIAL_HOST_SETTLE_MS)),
        delay(INITIAL_HOST_WAIT_MS),
      ]);
    }

    return [...activeKeys].flatMap(
      (key) => this.hostCache.get(key)?.rows ?? [],
    );
  };

  /** Returns the latest structured failure retained by this store. */
  hostFailures(): RemoteHostFailure[] {
    return [...this.hostCache.values()].flatMap((entry) =>
      entry.failure ? [entry.failure] : [],
    );
  }
}

export async function readFastModeFromHost(
  connection: RemoteConnection,
  sshCommand = "ssh",
): Promise<boolean> {
  const session = new AppServerSession(connection, sshCommand);
  try {
    await initializeAppServer(session, connection.hostId);
    const message = await session.request("config/read", {
      includeLayers: false,
    });
    const result = decodeResultObject(
      connection.hostId,
      "config/read",
      message,
    );
    const config = asObject(result.config);
    if (!config) {
      throw new RemoteReadError(
        "protocol",
        `Invalid config/read config from ${connection.hostId}`,
      );
    }
    return fastModeEnabledFromConfig(
      config.service_tier,
      asObject(config.features)?.fast_mode,
    );
  } finally {
    session.close();
  }
}

export async function readThreadsFromHost(
  connection: RemoteConnection,
  projectPaths: readonly string[],
  sshCommand = "ssh",
  readRolloutTails: RemoteRolloutTailReader = readRolloutTailsFromHost,
): Promise<RemoteThreadRow[]> {
  if (projectPaths.length === 0) return [];

  const session = new AppServerSession(connection, sshCommand);
  let remotePlatform = inferRemotePlatform(projectPaths);
  let threads: Map<string, AppServerThread>;
  let turns: Map<string, AppServerTurn>;
  try {
    const initializeResult = await initializeAppServer(
      session,
      connection.hostId,
    );
    remotePlatform = detectRemotePlatform(initializeResult, projectPaths);

    const normalizedProjectPaths = normalizeRemotePaths(
      projectPaths,
      remotePlatform,
    );
    threads = await readAppServerThreads(
      session,
      connection.hostId,
      normalizedProjectPaths,
      remotePlatform,
    );
    turns = await readAppServerTurns(session, connection.hostId, threads);
  } finally {
    session.close();
  }

  const selectedThreads = [...threads.values()];
  if (selectedThreads.length === 0) return [];
  const rolloutPaths = selectedThreads.flatMap((thread) =>
    typeof thread.path === "string" ? [thread.path] : [],
  );
  let rollouts = new Map<string, RolloutRecord[]>();
  if (rolloutPaths.length > 0) {
    try {
      rollouts = await readRolloutTails(
        connection,
        rolloutPaths,
        sshCommand,
        remotePlatform,
      );
    } catch (error) {
      throw error instanceof RemoteReadError
        ? error
        : new RemoteReadError(
            "rollout",
            `Failed to read persisted Codex status from ${connection.hostId}`,
            { cause: error },
          );
    }
  }

  const rowsById = new Map(
    selectedThreads.flatMap((thread) => {
      const row = remoteThreadRow(
        connection.hostId,
        thread,
        turns.get(String(thread.id)),
        typeof thread.path === "string" ? rollouts.get(thread.path) : undefined,
        remotePlatform,
      );
      return row ? [[row.id, row] as const] : [];
    }),
  );

  return selectedThreads.flatMap((thread) => {
    if (isSubagentThread(thread)) return [];
    const row = rowsById.get(String(thread.id));
    if (!row) return [];
    const subtaskStatuses = selectedThreads
      .filter((candidate) => subagentParentId(candidate) === row.id)
      .map((candidate) => rowsById.get(String(candidate.id))?.status)
      .filter((status): status is AgentStatus => status !== undefined);
    return [subtaskStatuses.length > 0 ? { ...row, subtaskStatuses } : row];
  });
}

async function initializeAppServer(
  session: AppServerSession,
  hostId: string,
): Promise<JsonObject> {
  const message = await session.request("initialize", {
    capabilities: { experimentalApi: true },
    clientInfo: {
      name: "chatgato",
      title: "ChatGato",
      version: "0.1.0",
    },
  });
  const result = decodeResultObject(hostId, "initialize", message);
  session.notify("initialized", {});
  return result;
}

async function readAppServerThreads(
  session: AppServerSession,
  hostId: string,
  projectPaths: readonly string[],
  platform: RemotePlatform,
): Promise<Map<string, AppServerThread>> {
  const seenCursors = new Set<string>();
  const threads = new Map<string, AppServerThread>();
  let cursor: string | undefined;

  do {
    const message = await session.request("thread/list", {
      archived: false,
      ...(cursor ? { cursor } : {}),
      limit: THREADS_PER_PAGE,
      sortDirection: "desc",
      sortKey: "recency_at",
      useStateDbOnly: true,
    });
    const page = decodeThreadPage(hostId, message);
    for (const thread of page.data as AppServerThread[]) {
      if (
        typeof thread.id === "string" &&
        typeof thread.cwd === "string" &&
        projectPaths.some((path) =>
          isWithinRemotePath(thread.cwd as string, path, platform),
        )
      ) {
        threads.set(thread.id, thread);
      }
    }

    cursor = page.nextCursor;
    if (cursor && seenCursors.has(cursor)) {
      throw new RemoteReadError(
        "protocol",
        `Codex app-server repeated a thread/list cursor on ${hostId}`,
      );
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  retainRecentThreadTrees(threads, MAX_AGENT_SLOTS);
  return threads;
}

function isSubagentThread(thread: AppServerThread): boolean {
  if (subagentParentId(thread)) return true;
  const source = asObject(thread.source);
  return source !== null && source.subAgent !== undefined;
}

function subagentParentId(thread: AppServerThread): string | null {
  if (typeof thread.parentThreadId === "string") return thread.parentThreadId;
  const source = asObject(thread.source);
  const subAgent = asObject(source?.subAgent);
  const threadSpawn = asObject(subAgent?.thread_spawn ?? subAgent?.threadSpawn);
  const parentId = threadSpawn?.parent_thread_id ?? threadSpawn?.parentThreadId;
  return typeof parentId === "string" ? parentId : null;
}

function retainRecentThreadTrees(
  threads: Map<string, AppServerThread>,
  rootLimit: number,
): void {
  const roots = new Map(
    [...threads].filter(([, thread]) => !isSubagentThread(thread)),
  );
  retainRecentThreads(roots, rootLimit);
  const rootIds = new Set(roots.keys());

  for (const [threadId, thread] of threads) {
    const parentId = subagentParentId(thread);
    if (parentId && rootIds.has(parentId)) roots.set(threadId, thread);
  }

  threads.clear();
  for (const [threadId, thread] of roots) threads.set(threadId, thread);
}

async function readAppServerTurns(
  session: AppServerSession,
  hostId: string,
  threads: ReadonlyMap<string, AppServerThread>,
): Promise<Map<string, AppServerTurn>> {
  const turns = await Promise.all(
    [...threads.keys()].map(async (threadId) => {
      const message = await session.request("thread/turns/list", {
        itemsView: "summary",
        limit: 1,
        sortDirection: "desc",
        threadId,
      });
      const data = decodeDataPage(hostId, "thread/turns/list", message);
      return data[0] ? ([threadId, data[0] as AppServerTurn] as const) : null;
    }),
  );
  return new Map(turns.filter((turn) => turn !== null));
}

export function remoteAgentStatus(
  threadStatus: AppServerThreadStatus | undefined,
  turn: AppServerTurn | undefined,
): AgentStatus {
  const runtimeType =
    typeof threadStatus?.type === "string"
      ? threadStatus.type.toLowerCase()
      : "";
  const activeFlags = Array.isArray(threadStatus?.activeFlags)
    ? threadStatus.activeFlags
        .filter((flag): flag is string => typeof flag === "string")
        .map((flag) => flag.toLowerCase())
    : [];
  const itemStates = Array.isArray(turn?.items)
    ? turn.items.flatMap((item) => {
        const object = asObject(item);
        return object
          ? [object.type, object.status].filter(
              (value): value is string => typeof value === "string",
            )
          : [];
      })
    : [];
  const waitingStates = [...activeFlags, ...itemStates].map((value) =>
    value.toLowerCase(),
  );

  if (waitingStates.some((value) => value.includes("approval"))) {
    return "awaiting-approval";
  }
  if (
    waitingStates.some(
      (value) =>
        value.includes("userinput") ||
        value.includes("user_input") ||
        value.includes("elicitation"),
    )
  ) {
    return "awaiting-response";
  }
  if (runtimeType === "systemerror") return "error";
  if (runtimeType === "active") return "working";

  const turnStatus =
    typeof turn?.status === "string" ? turn.status.toLowerCase() : "";
  switch (turnStatus) {
    case "completed":
      return "unread";
    case "inprogress":
    case "in_progress":
    case "running":
      return "working";
    case "failed":
    case "interrupted":
    case "cancelled":
    case "canceled":
      return "error";
    default:
      return "idle";
  }
}

function remoteThreadRow(
  hostId: string,
  thread: AppServerThread,
  turn: AppServerTurn | undefined,
  rolloutRecords: readonly RolloutRecord[] | undefined,
  platform: RemotePlatform,
): RemoteThreadRow | null {
  if (
    typeof thread.id !== "string" ||
    typeof thread.cwd !== "string" ||
    (thread.path !== null && typeof thread.path !== "string")
  ) {
    return null;
  }
  const preview =
    typeof thread.preview === "string"
      ? thread.preview.split(/\r?\n/u)[0]?.trim()
      : "";
  const title =
    typeof thread.name === "string" && thread.name.trim()
      ? thread.name.trim()
      : preview || "Untitled chat";
  const updatedAtMs = secondsToMilliseconds(thread.updatedAt);
  const recencyAtMs = secondsToMilliseconds(thread.recencyAt) || updatedAtMs;

  return {
    cwd: normalizeRemotePath(thread.cwd, platform),
    id: thread.id,
    recencyAtMs,
    remoteHostId: hostId,
    remotePlatform: platform,
    rolloutPath: thread.path,
    status:
      rolloutRecords === undefined
        ? remoteAgentStatus(thread.status, turn)
        : inferRolloutStatus(rolloutRecords),
    title,
    updatedAtMs,
  };
}

async function readGlobalState(codexHome: string): Promise<unknown | null> {
  try {
    return JSON.parse(
      await readFile(join(codexHome, ".codex-global-state.json"), "utf8"),
    ) as unknown;
  } catch {
    return null;
  }
}

function selectedRemoteConnection(state: unknown):
  | {
      connection: RemoteConnection | null;
      isRemote: true;
      selectionId: string;
    }
  | { isRemote: false } {
  const root = asObject(state);
  const selectedProject = asObject(root?.["selected-project"]);
  if (selectedProject?.type !== "remote") return { isRemote: false };

  const projectId = selectedProject.projectId;
  const remoteProjects = root?.["remote-projects"];
  const selectedProjectRecord = Array.isArray(remoteProjects)
    ? remoteProjects.map(asObject).find((project) => project?.id === projectId)
    : null;
  const hostId =
    typeof selectedProjectRecord?.hostId === "string"
      ? selectedProjectRecord.hostId
      : typeof root?.["selected-remote-host-id"] === "string"
        ? root["selected-remote-host-id"]
        : null;
  const selectionId = JSON.stringify(["remote", hostId, projectId]);
  const rawConnections = root?.["codex-managed-remote-connections"];
  if (!hostId || !Array.isArray(rawConnections)) {
    return { connection: null, isRemote: true, selectionId };
  }

  const connection = rawConnections
    .map(parseRemoteConnection)
    .find((candidate) => candidate?.hostId === hostId);
  return { connection: connection ?? null, isRemote: true, selectionId };
}

function remoteProjectGroups(state: unknown): Map<string, RemoteProjectGroup> {
  const root = asObject(state);
  if (!root) return new Map();

  const connections = new Map<string, RemoteConnection>();
  const rawConnections = root["codex-managed-remote-connections"];
  if (Array.isArray(rawConnections)) {
    for (const value of rawConnections) {
      const connection = parseRemoteConnection(value);
      if (connection) connections.set(connection.hostId, connection);
    }
  }

  const groups = new Map<string, RemoteProjectGroup>();
  const addPath = (hostId: unknown, path: unknown): void => {
    if (typeof hostId !== "string" || typeof path !== "string") return;
    const connection = connections.get(hostId);
    if (!connection) return;
    let group = groups.get(hostId);
    if (!group) {
      group = { connection, paths: new Set() };
      groups.set(hostId, group);
    }
    group.paths.add(normalizeRemotePath(path, inferRemotePlatform([path])));
  };

  const remoteProjects = root["remote-projects"];
  if (Array.isArray(remoteProjects)) {
    for (const value of remoteProjects) {
      const project = asObject(value);
      if (project) addPath(project.hostId, project.remotePath);
    }
  }

  const assignments = asObject(root["thread-project-assignments"]);
  if (assignments) {
    for (const value of Object.values(assignments)) {
      const assignment = asObject(value);
      if (assignment?.projectKind === "remote") {
        addPath(assignment.hostId, assignment.path);
        addPath(assignment.hostId, assignment.cwd);
      }
    }
  }

  return groups;
}

function parseRemoteConnection(value: unknown): RemoteConnection | null {
  const connection = asObject(value);
  if (!connection || typeof connection.hostId !== "string") return null;
  const alias =
    typeof connection.alias === "string" ? connection.alias.trim() : "";
  const hostname =
    typeof connection.hostname === "string" ? connection.hostname.trim() : "";
  const user =
    typeof connection.user === "string"
      ? connection.user.trim()
      : typeof connection.username === "string"
        ? connection.username.trim()
        : "";
  const destination =
    alias || (user && hostname ? `${user}@${hostname}` : hostname);
  if (
    !destination ||
    destination.startsWith("-") ||
    !/^[\w+.@:%-]+$/u.test(destination)
  ) {
    return null;
  }

  const port = Number(connection.sshPort);
  const identity =
    typeof connection.identity === "string" && connection.identity
      ? connection.identity
      : undefined;
  return {
    destination,
    hostId: connection.hostId,
    identity,
    port:
      Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : undefined,
  };
}

async function refreshRemoteHost(
  entry: RemoteHostCacheEntry,
  connection: RemoteConnection,
  projectPaths: readonly string[],
  readHostThreads: RemoteHostThreadReader,
): Promise<void> {
  try {
    entry.rows = await readHostThreads(connection, projectPaths);
    entry.hasValue = true;
    entry.failure = undefined;
  } catch (error) {
    const failure: RemoteHostFailure = {
      atMs: Date.now(),
      hostId: connection.hostId,
      kind: error instanceof RemoteReadError ? error.kind : "transport",
      message: error instanceof Error ? error.message : String(error),
    };
    if (
      entry.failure?.kind !== failure.kind ||
      entry.failure.message !== failure.message
    ) {
      console.warn("Remote Codex host refresh failed", failure);
    }
    entry.failure = failure;
  } finally {
    entry.expiresAtMs = Date.now() + REMOTE_HOST_CACHE_MS;
    entry.refresh = undefined;
  }
}

async function readRolloutTailsFromHost(
  connection: RemoteConnection,
  rolloutPaths: readonly string[],
  sshCommand: string,
  platform: RemotePlatform,
): Promise<Map<string, RolloutRecord[]>> {
  const paths = [...new Set(rolloutPaths)];
  if (paths.length === 0) return new Map();

  const remoteCommand = remoteRolloutCommand(paths, platform);
  const child = spawn(sshCommand, sshArguments(connection, [remoteCommand]), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < 8_192) stderr += chunk.slice(0, 8_192 - stderr.length);
  });

  const output = await new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new RemoteReadError(
          "timeout",
          `Timed out reading persisted Codex status from ${connection.hostId}`,
        ),
      );
    }, APP_SERVER_TIMEOUT_MS);
    timeout.unref();

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new RemoteReadError(
          "rollout",
          `Failed to start rollout reader for ${connection.hostId}: ${error.message}`,
          { cause: error },
        ),
      );
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        const detail = stderr.trim();
        reject(
          new RemoteReadError(
            "rollout",
            `Rollout reader for ${connection.hostId} exited with code ${code}${
              detail ? `: ${detail}` : ""
            }`,
          ),
        );
        return;
      }
      resolve(Buffer.concat(stdoutChunks));
    });
  });

  const recordsByPath = new Map<string, RolloutRecord[]>();
  const text = output.toString("utf8");
  const marker = new RegExp(`${String.fromCharCode(30)}(\\d+)\\n`, "gu");
  const matches = [...text.matchAll(marker)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const pathIndex = Number(match[1]);
    const path = paths[pathIndex];
    if (!path) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    recordsByPath.set(path, parseRolloutLines(text.slice(start, end)));
  }
  if (recordsByPath.size !== paths.length) {
    console.warn("Some remote Codex rollout tails were unavailable", {
      hostId: connection.hostId,
      missingRollouts: paths.length - recordsByPath.size,
    });
  }
  return recordsByPath;
}

function sshArguments(
  connection: RemoteConnection,
  remoteCommand: readonly string[],
): string[] {
  const result = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"];
  if (connection.port !== undefined) {
    result.push("-p", String(connection.port));
  }
  if (connection.identity) {
    result.push("-i", connection.identity);
  }
  result.push("--", connection.destination, ...remoteCommand);
  return result;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function remoteRolloutCommand(
  paths: readonly string[],
  platform: RemotePlatform,
): string {
  if (platform === "windows") {
    const pathArray = paths.map(powershellQuote).join(",");
    const script =
      `$paths=@(${pathArray});` +
      "$stdout=[System.Console]::OpenStandardOutput();" +
      "$utf8=[System.Text.UTF8Encoding]::new($false);" +
      "for($index=0;$index -lt $paths.Count;$index++){" +
      "$stream=$null;" +
      "try{$stream=[System.IO.File]::Open($paths[$index],[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,([System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete))}catch{continue};" +
      "try{" +
      '$marker=$utf8.GetBytes(([char]30).ToString()+$index+"`n");' +
      "$stdout.Write($marker,0,$marker.Length);" +
      `if($stream.Length -gt ${REMOTE_ROLLOUT_TAIL_BYTES}){[void]$stream.Seek($stream.Length-${REMOTE_ROLLOUT_TAIL_BYTES},[System.IO.SeekOrigin]::Begin)};` +
      "$buffer=New-Object byte[] 81920;" +
      "while(($read=$stream.Read($buffer,0,$buffer.Length)) -gt 0){$stdout.Write($buffer,0,$read)};" +
      "$stdout.WriteByte(10)" +
      "}finally{$stream.Dispose()}" +
      "};$stdout.Flush()";
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
  }

  const script =
    'index=0; for path do if [ -r "$path" ]; then ' +
    `printf '\\036%s\\n' "$index"; tail -c ${REMOTE_ROLLOUT_TAIL_BYTES} -- "$path"; printf '\\n'; ` +
    "fi; index=$((index + 1)); done";
  return `sh -c ${shellQuote(script)} sh ${paths.map(shellQuote).join(" ")}`;
}

function decodeThreadPage(
  hostId: string,
  message: JsonObject,
): { data: JsonObject[]; nextCursor?: string } {
  const result = decodeResultObject(hostId, "thread/list", message);
  const data = decodeObjectArray(hostId, "thread/list", result.data);
  if (
    data.some(
      (thread) =>
        typeof thread.id !== "string" ||
        typeof thread.cwd !== "string" ||
        (thread.path !== null && typeof thread.path !== "string"),
    )
  ) {
    throw new RemoteReadError(
      "protocol",
      `Invalid thread/list thread from ${hostId}`,
    );
  }
  if (
    result.nextCursor !== undefined &&
    result.nextCursor !== null &&
    typeof result.nextCursor !== "string"
  ) {
    throw new RemoteReadError(
      "protocol",
      `Invalid thread/list cursor from ${hostId}`,
    );
  }
  return {
    data,
    ...(typeof result.nextCursor === "string"
      ? { nextCursor: result.nextCursor }
      : {}),
  };
}

function decodeDataPage(
  hostId: string,
  method: string,
  message: JsonObject,
): JsonObject[] {
  const result = decodeResultObject(hostId, method, message);
  return decodeObjectArray(hostId, method, result.data);
}

function decodeResultObject(
  hostId: string,
  method: string,
  message: JsonObject,
): JsonObject {
  const result = asObject(message.result);
  if (!result) {
    throw new RemoteReadError(
      "protocol",
      `Invalid ${method} result from ${hostId}`,
    );
  }
  return result;
}

function decodeObjectArray(
  hostId: string,
  method: string,
  value: unknown,
): JsonObject[] {
  if (!Array.isArray(value)) {
    throw new RemoteReadError(
      "protocol",
      `Invalid ${method} data from ${hostId}`,
    );
  }
  const objects = value.map(asObject);
  if (objects.some((object) => object === null)) {
    throw new RemoteReadError(
      "protocol",
      `Invalid ${method} item from ${hostId}`,
    );
  }
  return objects as JsonObject[];
}

function jsonRpcResponseError(
  hostId: string,
  message: JsonObject,
): RemoteReadError {
  const error = asObject(message.error);
  const code =
    typeof error?.code === "number" || typeof error?.code === "string"
      ? ` (${error.code})`
      : "";
  const detail =
    typeof error?.message === "string"
      ? error.message
      : "Malformed JSON-RPC error";
  return new RemoteReadError(
    "protocol",
    `Codex app-server request ${String(message.id)} failed on ${hostId}${code}: ${detail}`,
  );
}

function remoteHostCacheKey(codexHome: string, hostId: string): string {
  return `${codexHome}\0${hostId}`;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    timeout.unref();
  });
}

function retainRecentThreads(
  threads: Map<string, AppServerThread>,
  limit: number,
): void {
  const selected = [...threads.entries()]
    .sort(
      ([, left], [, right]) =>
        secondsToMilliseconds(right.recencyAt) -
        secondsToMilliseconds(left.recencyAt),
    )
    .slice(0, limit);
  threads.clear();
  for (const [threadId, thread] of selected) threads.set(threadId, thread);
}

export function isWithinRemotePath(
  cwd: string,
  root: string,
  platform: RemotePlatform,
): boolean {
  const pathApi = platform === "windows" ? win32 : posix;
  const relative = pathApi.relative(
    normalizeRemotePath(root, platform),
    normalizeRemotePath(cwd, platform),
  );
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  );
}

function normalizeRemotePath(path: string, platform: RemotePlatform): string {
  return (platform === "windows" ? win32 : posix).normalize(path.trim());
}

function normalizeRemotePaths(
  paths: readonly string[],
  platform: RemotePlatform,
): string[] {
  return [...new Set(paths.map((path) => normalizeRemotePath(path, platform)))];
}

function detectRemotePlatform(
  initializeResult: JsonObject,
  projectPaths: readonly string[],
): RemotePlatform {
  const identifiers = [
    initializeResult.platformFamily,
    initializeResult.platformOs,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  if (identifiers.some((value) => value.includes("windows"))) {
    return "windows";
  }
  if (
    identifiers.some((value) =>
      /^(?:android|darwin|freebsd|linux|macos|openbsd|unix)$/u.test(value),
    )
  ) {
    return "posix";
  }
  return inferRemotePlatform(projectPaths);
}

function inferRemotePlatform(paths: readonly string[]): RemotePlatform {
  return paths.some((path) => {
    const trimmed = path.trim();
    return win32.isAbsolute(trimmed) && !posix.isAbsolute(trimmed);
  })
    ? "windows"
    : "posix";
}

function secondsToMilliseconds(value: unknown): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}
