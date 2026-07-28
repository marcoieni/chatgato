import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { createInterface } from "node:readline";
import { inferRolloutStatus, parseRolloutLines } from "./rollout-status.js";
import type { AgentStatus, RolloutRecord } from "../types.js";

const APP_SERVER_TIMEOUT_MS = 8_000;
const INITIAL_HOST_WAIT_MS = 500;
const INITIAL_HOST_SETTLE_MS = 25;
const REMOTE_HOST_CACHE_MS = 1_000;
const REMOTE_ROLLOUT_TAIL_BYTES = 512 * 1024;
const THREADS_PER_PROJECT = 20;
const THREADS_PER_PAGE = 100;

type JsonObject = Record<string, unknown>;

type RemoteConnection = {
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
  path?: unknown;
  preview?: unknown;
  recencyAt?: unknown;
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
  rolloutPath: string;
  status: AgentStatus;
  title: string;
  updatedAtMs: number;
};

export type RemoteHostThreadReader = (
  connection: RemoteConnection,
  projectPaths: readonly string[],
) => Promise<RemoteThreadRow[]>;

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

export type RemoteRolloutTailReader = (
  connection: RemoteConnection,
  rolloutPaths: readonly string[],
  sshCommand: string,
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

const remoteHostCache = new Map<string, RemoteHostCacheEntry>();

/**
 * Reads SSH projects saved by the desktop app and asks each host's Codex app
 * server for its recent tasks. Host results use stale-while-revalidate caching,
 * so an unavailable host cannot delay local or healthy-host task discovery.
 */
export async function readRemoteThreadRows(
  codexHome: string,
  readHostThreads: RemoteHostThreadReader = readThreadsFromHost,
): Promise<RemoteThreadRow[]> {
  let state: unknown;
  try {
    state = JSON.parse(
      await readFile(join(codexHome, ".codex-global-state.json"), "utf8"),
    ) as unknown;
  } catch {
    return [];
  }

  const groups = remoteProjectGroups(state);
  const activeKeys = new Set<string>();
  const initialRefreshes: Promise<void>[] = [];

  for (const { connection, paths } of groups.values()) {
    const key = remoteHostCacheKey(codexHome, connection.hostId);
    activeKeys.add(key);
    const normalizedPaths = [...paths].sort();
    const signature = JSON.stringify([connection, normalizedPaths]);
    let entry = remoteHostCache.get(key);
    if (!entry || entry.signature !== signature) {
      entry = {
        expiresAtMs: 0,
        hasValue: false,
        rows: [],
        signature,
      };
      remoteHostCache.set(key, entry);
    }

    if (!entry.refresh && entry.expiresAtMs <= Date.now()) {
      const wasEmpty = !entry.hasValue;
      entry.refresh = refreshRemoteHost(
        entry,
        connection,
        normalizedPaths,
        readHostThreads,
      );
      if (wasEmpty) initialRefreshes.push(entry.refresh);
    }
  }

  for (const key of remoteHostCache.keys()) {
    if (key.startsWith(`${codexHome}\0`) && !activeKeys.has(key)) {
      remoteHostCache.delete(key);
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

  return [...activeKeys].flatMap((key) => remoteHostCache.get(key)?.rows ?? []);
}

/** Returns the latest structured failure retained for each remote host. */
export function remoteHostFailures(): RemoteHostFailure[] {
  return [...remoteHostCache.values()].flatMap((entry) =>
    entry.failure ? [entry.failure] : [],
  );
}

export async function readThreadsFromHost(
  connection: RemoteConnection,
  projectPaths: readonly string[],
  sshCommand = "ssh",
  readRolloutTails: RemoteRolloutTailReader = readRolloutTailsFromHost,
): Promise<RemoteThreadRow[]> {
  if (projectPaths.length === 0) return [];

  const child = spawn(
    sshCommand,
    sshArguments(connection, ["codex", "app-server"]),
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < 8_192) stderr += chunk.slice(0, 8_192 - stderr.length);
  });
  const lines = createInterface({ input: child.stdout });

  return await new Promise<RemoteThreadRow[]>((resolve, reject) => {
    let settled = false;
    let nextRequestId = 1;
    let listRequestId: number | null = null;
    const seenCursors = new Set<string>();
    const turnRequestIds = new Map<number, string>();
    const threads = new Map<string, AppServerThread>();
    const turns = new Map<string, AppServerTurn>();

    const timeout = setTimeout(() => {
      fail(
        new RemoteReadError(
          "timeout",
          `Timed out reading Codex tasks from ${connection.hostId}`,
        ),
      );
    }, APP_SERVER_TIMEOUT_MS);
    timeout.unref();

    function cleanup(): void {
      clearTimeout(timeout);
      lines.close();
      if (!child.stdin.destroyed && !child.stdin.writableEnded) {
        child.stdin.end();
      }
      if (child.exitCode === null) child.kill();
    }

    function succeed(): void {
      if (settled) return;
      settled = true;
      cleanup();
      const selectedThreads = [...threads.values()];
      if (selectedThreads.length === 0) {
        resolve([]);
        return;
      }
      const rolloutPaths = selectedThreads.flatMap((thread) =>
        typeof thread.path === "string" ? [thread.path] : [],
      );
      void readRolloutTails(connection, rolloutPaths, sshCommand).then(
        (rollouts) => {
          resolve(
            selectedThreads
              .map((thread) =>
                remoteThreadRow(
                  connection.hostId,
                  thread,
                  turns.get(String(thread.id)),
                  typeof thread.path === "string"
                    ? rollouts.get(thread.path)
                    : undefined,
                ),
              )
              .filter((row): row is RemoteThreadRow => row !== null),
          );
        },
        (error: unknown) => {
          reject(
            error instanceof RemoteReadError
              ? error
              : new RemoteReadError(
                  "rollout",
                  `Failed to read persisted Codex status from ${connection.hostId}`,
                  { cause: error },
                ),
          );
        },
      );
    }

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function send(message: JsonObject): boolean {
      if (
        settled ||
        child.stdin.destroyed ||
        child.stdin.writableEnded ||
        !child.stdin.writable
      ) {
        fail(
          new RemoteReadError(
            "transport",
            `Codex app-server stdin closed for ${connection.hostId}`,
          ),
        );
        return false;
      }

      try {
        child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
          if (error) {
            fail(
              new RemoteReadError(
                "transport",
                `Failed to write to Codex app-server on ${connection.hostId}: ${error.message}`,
                { cause: error },
              ),
            );
          }
        });
        return true;
      } catch (error) {
        fail(
          new RemoteReadError(
            "transport",
            `Failed to write to Codex app-server on ${connection.hostId}`,
            { cause: error },
          ),
        );
        return false;
      }
    }

    function requestThreadPage(cursor?: string): void {
      const requestId = nextRequestId++;
      listRequestId = requestId;
      send({
        id: requestId,
        method: "thread/list",
        params: {
          archived: false,
          ...(cursor ? { cursor } : {}),
          limit: THREADS_PER_PAGE,
          sortDirection: "desc",
          sortKey: "recency_at",
          useStateDbOnly: true,
        },
      });
    }

    function requestTurns(): void {
      if (threads.size === 0) {
        succeed();
        return;
      }
      for (const thread of threads.values()) {
        if (typeof thread.id !== "string") continue;
        const requestId = nextRequestId++;
        turnRequestIds.set(requestId, thread.id);
        send({
          id: requestId,
          method: "thread/turns/list",
          params: {
            itemsView: "summary",
            limit: 1,
            sortDirection: "desc",
            threadId: thread.id,
          },
        });
      }
      if (turnRequestIds.size === 0) succeed();
    }

    lines.on("line", (line) => {
      if (settled || !line.trim()) return;

      let message: JsonObject;
      try {
        const decoded = JSON.parse(line) as unknown;
        const object = asObject(decoded);
        if (!object) throw new Error("message is not an object");
        message = object;
      } catch (error) {
        fail(
          new RemoteReadError(
            "protocol",
            `Invalid JSON-RPC message from ${connection.hostId}`,
            { cause: error },
          ),
        );
        return;
      }

      if (message.error !== undefined) {
        fail(jsonRpcResponseError(connection.hostId, message));
        return;
      }

      if (message.id === 0) {
        try {
          decodeResultObject(connection.hostId, "initialize", message);
        } catch (error) {
          fail(asError(error));
          return;
        }
        send({ method: "initialized", params: {} });
        requestThreadPage();
        return;
      }

      if (typeof message.id !== "number") return;
      if (message.id === listRequestId) {
        let page: { data: JsonObject[]; nextCursor?: string };
        try {
          page = decodeThreadPage(connection.hostId, message);
        } catch (error) {
          fail(asError(error));
          return;
        }
        listRequestId = null;
        for (const thread of page.data as AppServerThread[]) {
          const cwd = thread.cwd;
          if (
            typeof thread.id === "string" &&
            typeof cwd === "string" &&
            projectPaths.some((path) => isWithinRemotePath(cwd, path))
          ) {
            threads.set(thread.id, thread);
          }
        }

        if (page.nextCursor) {
          if (seenCursors.has(page.nextCursor)) {
            fail(
              new RemoteReadError(
                "protocol",
                `Codex app-server repeated a thread/list cursor on ${connection.hostId}`,
              ),
            );
            return;
          }
          seenCursors.add(page.nextCursor);
          requestThreadPage(page.nextCursor);
        } else {
          retainRecentProjectThreads(threads, projectPaths);
          requestTurns();
        }
        return;
      }

      const threadId = turnRequestIds.get(message.id);
      if (!threadId) return;
      turnRequestIds.delete(message.id);
      try {
        const data = decodeDataPage(
          connection.hostId,
          "thread/turns/list",
          message,
        );
        if (data[0]) turns.set(threadId, data[0] as AppServerTurn);
      } catch (error) {
        fail(asError(error));
        return;
      }
      if (turnRequestIds.size === 0) succeed();
    });

    child.stdin.on("error", (error) => {
      fail(
        new RemoteReadError(
          "transport",
          `Codex app-server stdin failed for ${connection.hostId}: ${error.message}`,
          { cause: error },
        ),
      );
    });
    child.once("error", (error) => {
      fail(
        new RemoteReadError(
          "transport",
          `Failed to start SSH for ${connection.hostId}: ${error.message}`,
          { cause: error },
        ),
      );
    });
    child.once("close", (code) => {
      if (!settled) {
        const detail = stderr.trim();
        fail(
          new RemoteReadError(
            "transport",
            `Codex app-server for ${connection.hostId} exited with code ${code}${
              detail ? `: ${detail}` : ""
            }`,
          ),
        );
      }
    });

    send({
      id: 0,
      method: "initialize",
      params: {
        capabilities: { experimentalApi: true },
        clientInfo: {
          name: "chatgato",
          title: "ChatGato",
          version: "0.1.0",
        },
      },
    });
  });
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
): RemoteThreadRow | null {
  if (
    typeof thread.id !== "string" ||
    typeof thread.cwd !== "string" ||
    typeof thread.path !== "string"
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
      : preview || "Untitled task";
  const updatedAtMs = secondsToMilliseconds(thread.updatedAt);
  const recencyAtMs = secondsToMilliseconds(thread.recencyAt) || updatedAtMs;

  return {
    cwd: normalizeRemotePath(thread.cwd),
    id: thread.id,
    recencyAtMs,
    remoteHostId: hostId,
    rolloutPath: thread.path,
    status:
      rolloutRecords === undefined
        ? remoteAgentStatus(thread.status, turn)
        : inferRolloutStatus(rolloutRecords),
    title,
    updatedAtMs,
  };
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
    group.paths.add(normalizeRemotePath(path));
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
): Promise<Map<string, RolloutRecord[]>> {
  const paths = [...new Set(rolloutPaths)];
  if (paths.length === 0) return new Map();

  const script =
    'index=0; for path do if [ -r "$path" ]; then ' +
    `printf '\\036%s\\n' "$index"; tail -c ${REMOTE_ROLLOUT_TAIL_BYTES} -- "$path"; printf '\\n'; ` +
    "fi; index=$((index + 1)); done";
  const remoteCommand = `sh -c ${shellQuote(script)} sh ${paths
    .map(shellQuote)
    .join(" ")}`;
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

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
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

function retainRecentProjectThreads(
  threads: Map<string, AppServerThread>,
  projectPaths: readonly string[],
): void {
  const counts = projectPaths.map(() => 0);
  const selected = new Map<string, AppServerThread>();
  const sorted = [...threads.values()].sort(
    (left, right) =>
      secondsToMilliseconds(right.recencyAt) -
      secondsToMilliseconds(left.recencyAt),
  );

  for (const thread of sorted) {
    if (typeof thread.id !== "string" || typeof thread.cwd !== "string") {
      continue;
    }
    const matchingIndexes = projectPaths.flatMap((path, index) =>
      isWithinRemotePath(thread.cwd as string, path) ? [index] : [],
    );
    if (
      !matchingIndexes.some(
        (index) => (counts[index] ?? THREADS_PER_PROJECT) < THREADS_PER_PROJECT,
      )
    ) {
      continue;
    }

    selected.set(thread.id, thread);
    for (const index of matchingIndexes) {
      if ((counts[index] ?? THREADS_PER_PROJECT) < THREADS_PER_PROJECT) {
        counts[index] = (counts[index] ?? 0) + 1;
      }
    }
  }

  threads.clear();
  for (const [threadId, thread] of selected) threads.set(threadId, thread);
}

function isWithinRemotePath(cwd: string, root: string): boolean {
  const normalizedCwd = normalizeRemotePath(cwd);
  const normalizedRoot = normalizeRemotePath(root);
  return (
    normalizedCwd === normalizedRoot ||
    normalizedCwd.startsWith(
      normalizedRoot === "/" ? "/" : `${normalizedRoot}/`,
    )
  );
}

function normalizeRemotePath(path: string): string {
  return posix.normalize(path.trim());
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
