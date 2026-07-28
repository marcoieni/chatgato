import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { createInterface } from "node:readline";
import type { AgentStatus } from "../types.js";

const APP_SERVER_TIMEOUT_MS = 8_000;
const THREADS_PER_PROJECT = 20;

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

type RemoteProjectGroup = {
  connection: RemoteConnection;
  paths: Set<string>;
};

/**
 * Reads SSH projects saved by the desktop app and asks each host's Codex app
 * server for its recent tasks. An unavailable host is isolated from the other
 * hosts and from local task discovery.
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
  const results = await Promise.all(
    [...groups.values()].map(async ({ connection, paths }) => {
      try {
        return await readHostThreads(connection, [...paths]);
      } catch {
        return [];
      }
    }),
  );
  return results.flat();
}

export async function readThreadsFromHost(
  connection: RemoteConnection,
  projectPaths: readonly string[],
  sshCommand = "ssh",
): Promise<RemoteThreadRow[]> {
  if (projectPaths.length === 0) return [];

  const sshArguments = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5"];
  if (connection.port !== undefined) {
    sshArguments.push("-p", String(connection.port));
  }
  if (connection.identity) {
    sshArguments.push("-i", connection.identity);
  }
  sshArguments.push("--", connection.destination, "codex", "app-server");

  const child = spawn(sshCommand, sshArguments, {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const lines = createInterface({ input: child.stdout });

  return await new Promise<RemoteThreadRow[]>((resolve, reject) => {
    let settled = false;
    let nextRequestId = 1;
    const listRequestIds = new Set<number>();
    const turnRequestIds = new Map<number, string>();
    const threads = new Map<string, AppServerThread>();
    const turns = new Map<string, AppServerTurn>();

    const timeout = setTimeout(() => {
      fail(
        new Error(`Timed out reading Codex tasks from ${connection.hostId}`),
      );
    }, APP_SERVER_TIMEOUT_MS);
    timeout.unref();

    function cleanup(): void {
      clearTimeout(timeout);
      lines.close();
      child.stdin.end();
      if (child.exitCode === null) child.kill();
    }

    function succeed(): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(
        [...threads.values()]
          .map((thread) =>
            remoteThreadRow(
              connection.hostId,
              thread,
              turns.get(String(thread.id)),
            ),
          )
          .filter((row): row is RemoteThreadRow => row !== null),
      );
    }

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function send(message: JsonObject): void {
      child.stdin.write(`${JSON.stringify(message)}\n`);
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
      let message: JsonObject;
      try {
        message = JSON.parse(line) as JsonObject;
      } catch {
        return;
      }

      if (message.id === 0) {
        if (message.error) {
          fail(new Error(`Codex app-server initialization failed`));
          return;
        }
        send({ method: "initialized", params: {} });
        for (const cwd of new Set(projectPaths.map(normalizeRemotePath))) {
          const requestId = nextRequestId++;
          listRequestIds.add(requestId);
          send({
            id: requestId,
            method: "thread/list",
            params: {
              archived: false,
              cwd,
              limit: THREADS_PER_PROJECT,
              sortDirection: "desc",
              sortKey: "recency_at",
              useStateDbOnly: true,
            },
          });
        }
        return;
      }

      if (typeof message.id !== "number") return;
      if (listRequestIds.delete(message.id)) {
        const result = asObject(message.result);
        const data = Array.isArray(result?.data) ? result.data : [];
        for (const candidate of data) {
          const thread = asObject(candidate) as AppServerThread | null;
          const cwd = thread?.cwd;
          if (
            thread &&
            typeof thread.id === "string" &&
            typeof cwd === "string" &&
            projectPaths.some((path) => isWithinRemotePath(cwd, path))
          ) {
            threads.set(thread.id, thread);
          }
        }
        if (listRequestIds.size === 0) requestTurns();
        return;
      }

      const threadId = turnRequestIds.get(message.id);
      if (!threadId) return;
      turnRequestIds.delete(message.id);
      const result = asObject(message.result);
      const data = Array.isArray(result?.data) ? result.data : [];
      const turn = asObject(data[0]) as AppServerTurn | null;
      if (turn) turns.set(threadId, turn);
      if (turnRequestIds.size === 0) succeed();
    });

    child.once("error", (error) => fail(error));
    child.once("close", (code) => {
      if (!settled) {
        fail(
          new Error(
            `Codex app-server for ${connection.hostId} exited with code ${code}`,
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
    status: remoteAgentStatus(thread.status, turn),
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
