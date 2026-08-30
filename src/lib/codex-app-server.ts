import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type {
  AgentStatus,
  CodexUsageSnapshot,
  CodexUsageWindow,
} from "../types.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const PROCESS_EXIT_GRACE_MS = 250;
const MAX_STDERR_LENGTH = 4_000;

type JsonObject = Record<string, unknown>;

export type CodexAppServerNotification = {
  method: string;
  params: JsonObject;
};

export type CodexAppServerThread = {
  cwd: string;
  id: string;
  parentThreadId: string | null;
  recencyAtMs: number;
  rolloutPath: string | null;
  status: AgentStatus | null;
  title: string;
  updatedAtMs: number;
};

export type CodexAppServerModel = {
  id: string;
  reasoningEfforts: string[];
};

export type CodexAppServerClientLike = {
  readConfig: () => Promise<JsonObject>;
  readModels: () => Promise<CodexAppServerModel[]>;
  readThreads: () => Promise<CodexAppServerThread[]>;
  readUsage: () => Promise<CodexUsageSnapshot>;
  subscribe: (
    listener: (notification: CodexAppServerNotification) => void,
  ) => () => void;
};

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (message: JsonObject) => void;
  timeout: NodeJS.Timeout;
};

class CodexAppServerResponseError extends Error {}

export type CodexAppServerClientOptions = {
  args?: readonly string[];
  executable?: string;
  now?: () => number;
  requestTimeoutMs?: number;
  startupTimeoutMs?: number;
};

const THREADS_PER_PAGE = 100;
const THREAD_TURN_STATUS_LIMIT = 40;
const THREAD_CACHE_MS = 1_000;
const CONFIG_CACHE_MS = 750;
const MODEL_CACHE_MS = 5 * 60_000;
const THREAD_SOURCE_KINDS = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
] as const;

class LocalAppServerSession {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly exited: Promise<void>;
  private readonly lines: Interface;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private closed = false;
  private didExit = false;
  private nextRequestId = 0;
  private stderr = "";
  private terminalError: Error | null = null;

  constructor(
    executable: string,
    args: readonly string[],
    private readonly onNotification: (
      notification: CodexAppServerNotification,
    ) => void,
    private readonly onTerminalError: (error: Error) => void,
  ) {
    this.child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.exited = new Promise((resolve) => {
      this.child.once("close", (code, signal) => {
        this.didExit = true;
        resolve();
        if (this.closed) return;
        const detail = this.stderr.trim();
        this.fail(
          new Error(
            `Codex app-server exited before responding (code ${code ?? "unknown"}${signal ? `, signal ${signal}` : ""})${detail ? `: ${detail}` : ""}`,
          ),
        );
      });
    });

    // The Stream Deck connection keeps the plugin alive. Do not make an idle
    // app-server child keep short-lived consumers such as tests alive by itself.
    this.child.unref();
    unrefStream(this.child.stdin);
    unrefStream(this.child.stdout);
    unrefStream(this.child.stderr);

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      if (this.stderr.length < MAX_STDERR_LENGTH) {
        this.stderr += chunk.slice(0, MAX_STDERR_LENGTH - this.stderr.length);
      }
    });

    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => this.handleLine(line));
    this.child.stdin.on("error", (error) => {
      this.fail(
        new Error(`Codex app-server stdin failed: ${error.message}`, {
          cause: error,
        }),
      );
    });
    this.child.once("error", (error) => {
      this.fail(
        new Error(`Failed to start Codex app-server: ${error.message}`, {
          cause: error,
        }),
      );
    });
  }

  request(
    method: string,
    timeoutMs: number,
    params?: JsonObject,
  ): Promise<JsonObject> {
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.closed) {
      return Promise.reject(new Error("Codex app-server session is closed"));
    }

    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const error = new Error(`Codex app-server ${method} timed out`);
        this.pendingRequests.delete(id);
        reject(error);
        this.fail(error);
      }, timeoutMs);
      timeout.unref();
      this.pendingRequests.set(id, { reject, resolve, timeout });
      this.send({ id, method, ...(params ? { params } : {}) });
    });
  }

  notify(method: string, params: JsonObject): void {
    this.send({ method, params });
  }

  async close(): Promise<void> {
    if (this.closed) {
      await this.waitForExit();
      return;
    }

    this.closed = true;
    this.lines.close();
    const error = new Error("Codex app-server session closed");
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();

    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
      this.child.stdin.end();
    }
    if (!this.didExit) this.child.kill();
    await this.waitForExit();
  }

  private handleLine(line: string): void {
    if (this.closed || !line.trim()) return;

    let message: JsonObject;
    try {
      const decoded = JSON.parse(line) as unknown;
      const object = asObject(decoded);
      if (!object) return;
      message = object;
    } catch {
      // A non-response line cannot be correlated with an outstanding request.
      // Keep waiting for the bounded request timeout rather than accepting it.
      return;
    }

    if (typeof message.id !== "number") {
      if (typeof message.method !== "string") return;
      this.onNotification({
        method: message.method,
        params: asObject(message.params) ?? {},
      });
      return;
    }
    if (!("result" in message) && !("error" in message)) return;
    const pending = this.pendingRequests.get(message.id);
    if (!pending) return;

    this.pendingRequests.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error !== undefined) {
      pending.reject(jsonRpcResponseError(message));
    } else {
      pending.resolve(message);
    }
  }

  private send(message: JsonObject): void {
    if (
      this.closed ||
      this.child.stdin.destroyed ||
      this.child.stdin.writableEnded ||
      !this.child.stdin.writable
    ) {
      this.fail(new Error("Codex app-server stdin is closed"));
      return;
    }

    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) {
          this.fail(
            new Error(`Failed to write to Codex app-server: ${error.message}`, {
              cause: error,
            }),
          );
        }
      });
    } catch (error) {
      this.fail(
        new Error("Failed to write to Codex app-server", { cause: error }),
      );
    }
  }

  private fail(error: Error): void {
    if (this.closed || this.terminalError) return;
    this.terminalError = error;
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
    this.lines.close();
    if (!this.child.stdin.destroyed && !this.child.stdin.writableEnded) {
      this.child.stdin.end();
    }
    if (!this.didExit) this.child.kill();
    this.onTerminalError(error);
  }

  private async waitForExit(): Promise<void> {
    if (this.didExit) return;
    await Promise.race([this.exited, delay(PROCESS_EXIT_GRACE_MS)]);
    if (this.didExit) return;
    this.child.kill("SIGKILL");
    await Promise.race([this.exited, delay(PROCESS_EXIT_GRACE_MS)]);
  }
}

/**
 * Owns one lazy, long-lived Codex app-server process shared by all local reads.
 * Protocol failures are surfaced to callers so actions can show an offline state.
 */
export class CodexAppServerClient implements CodexAppServerClientLike {
  private readonly args: readonly string[];
  private readonly executable: string;
  private readonly listeners = new Set<
    (notification: CodexAppServerNotification) => void
  >();
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly startupTimeoutMs: number;
  private connection: Promise<LocalAppServerSession> | null = null;
  private configCache: { expiresAtMs: number; value: JsonObject } | undefined;
  private configInFlight: Promise<JsonObject> | null = null;
  private modelsCache:
    { expiresAtMs: number; value: CodexAppServerModel[] } | undefined;
  private modelsInFlight: Promise<CodexAppServerModel[]> | null = null;
  private threadsCache:
    { expiresAtMs: number; value: CodexAppServerThread[] } | undefined;
  private threadsInFlight: Promise<CodexAppServerThread[]> | null = null;
  private usageInFlight: Promise<CodexUsageSnapshot> | null = null;

  constructor(options: CodexAppServerClientOptions = {}) {
    this.args = options.args ?? ["app-server"];
    this.executable = options.executable ?? defaultCodexExecutable();
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = positiveTimeout(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
    );
    this.startupTimeoutMs = positiveTimeout(
      options.startupTimeoutMs,
      DEFAULT_STARTUP_TIMEOUT_MS,
    );
  }

  readonly readUsage = (): Promise<CodexUsageSnapshot> => {
    if (this.usageInFlight) return this.usageInFlight;
    const read = this.readUsageOnce().finally(() => {
      if (this.usageInFlight === read) this.usageInFlight = null;
    });
    this.usageInFlight = read;
    return read;
  };

  readonly readConfig = (): Promise<JsonObject> => {
    const now = this.now();
    if (this.configCache && this.configCache.expiresAtMs > now) {
      return Promise.resolve(this.configCache.value);
    }
    if (this.configInFlight) return this.configInFlight;
    const read = this.requestResult("config/read", {
      includeLayers: false,
    })
      .then((result) => {
        const config = asObject(result.config);
        if (!config) throw new Error("Invalid config/read result from Codex");
        this.configCache = {
          expiresAtMs: this.now() + CONFIG_CACHE_MS,
          value: config,
        };
        return config;
      })
      .finally(() => {
        if (this.configInFlight === read) this.configInFlight = null;
      });
    this.configInFlight = read;
    return read;
  };

  readonly readModels = (): Promise<CodexAppServerModel[]> => {
    const now = this.now();
    if (this.modelsCache && this.modelsCache.expiresAtMs > now) {
      return Promise.resolve(this.modelsCache.value);
    }
    if (this.modelsInFlight) return this.modelsInFlight;
    const read = this.readModelsOnce().finally(() => {
      if (this.modelsInFlight === read) this.modelsInFlight = null;
    });
    this.modelsInFlight = read;
    return read;
  };

  readonly readThreads = (): Promise<CodexAppServerThread[]> => {
    const now = this.now();
    if (this.threadsCache && this.threadsCache.expiresAtMs > now) {
      return Promise.resolve(this.threadsCache.value);
    }
    if (this.threadsInFlight) return this.threadsInFlight;
    const read = this.readThreadsOnce()
      .then((threads) => {
        this.threadsCache = {
          expiresAtMs: this.now() + THREAD_CACHE_MS,
          value: threads,
        };
        return threads;
      })
      .finally(() => {
        if (this.threadsInFlight === read) this.threadsInFlight = null;
      });
    this.threadsInFlight = read;
    return read;
  };

  readonly subscribe = (
    listener: (notification: CodexAppServerNotification) => void,
  ): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.invalidateCaches();
    if (!connection) return;
    const session = await connection.catch(() => null);
    await session?.close();
  }

  private async readUsageOnce(): Promise<CodexUsageSnapshot> {
    const result = await this.requestResult("account/rateLimits/read");
    const usage = usageFromAppServerResult(result, this.now());
    if (!usage) {
      throw new Error("Invalid account/rateLimits/read result from Codex");
    }
    return usage;
  }

  private async readModelsOnce(): Promise<CodexAppServerModel[]> {
    const models: CodexAppServerModel[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await this.requestResult("model/list", {
        ...(cursor ? { cursor } : {}),
        includeHidden: true,
        limit: 100,
      });
      const data = Array.isArray(result.data) ? result.data : null;
      if (!data) throw new Error("Invalid model/list result from Codex");
      for (const value of data) {
        const model = parseModel(value);
        if (model) models.push(model);
      }
      cursor = readCursor(result.nextCursor);
      requireFreshCursor("model/list", cursor, seenCursors);
    } while (cursor);
    this.modelsCache = {
      expiresAtMs: this.now() + MODEL_CACHE_MS,
      value: models,
    };
    return models;
  }

  private async readThreadsOnce(): Promise<CodexAppServerThread[]> {
    const rawThreads: JsonObject[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const result = await this.requestResult("thread/list", {
        archived: false,
        ...(cursor ? { cursor } : {}),
        limit: THREADS_PER_PAGE,
        sortDirection: "desc",
        sortKey: "recency_at",
        sourceKinds: [...THREAD_SOURCE_KINDS],
        useStateDbOnly: true,
      });
      const data = Array.isArray(result.data) ? result.data : null;
      if (!data) throw new Error("Invalid thread/list result from Codex");
      for (const value of data) {
        const thread = asObject(value);
        if (thread) rawThreads.push(thread);
      }
      cursor = readCursor(result.nextCursor);
      requireFreshCursor("thread/list", cursor, seenCursors);
    } while (cursor);

    const recentThreads = rawThreads.slice(0, THREAD_TURN_STATUS_LIMIT);
    const turns = new Map(
      (
        await Promise.all(
          recentThreads.map(async (thread) => {
            const threadId = typeof thread.id === "string" ? thread.id : null;
            if (!threadId) return null;
            const result = await this.requestResult("thread/turns/list", {
              itemsView: "summary",
              limit: 1,
              sortDirection: "desc",
              threadId,
            });
            if (!Array.isArray(result.data)) {
              throw new Error("Invalid thread/turns/list result from Codex");
            }
            return [threadId, result.data[0]] as const;
          }),
        )
      ).filter((entry) => entry !== null),
    );

    return rawThreads
      .map((thread) =>
        parseThread(
          thread,
          typeof thread.id === "string" ? turns.get(thread.id) : undefined,
        ),
      )
      .filter((thread): thread is CodexAppServerThread => thread !== null)
      .sort(
        (left, right) =>
          right.recencyAtMs - left.recencyAtMs ||
          right.id.localeCompare(left.id),
      );
  }

  private async requestResult(
    method: string,
    params?: JsonObject,
  ): Promise<JsonObject> {
    const session = await this.session();
    try {
      const response = await session.request(
        method,
        this.requestTimeoutMs,
        params,
      );
      return requireResultObject(method, response);
    } catch (error) {
      if (!(error instanceof CodexAppServerResponseError)) {
        await session.close();
      }
      throw error;
    }
  }

  private session(): Promise<LocalAppServerSession> {
    if (this.connection) return this.connection;
    const session = new LocalAppServerSession(
      this.executable,
      this.args,
      (notification) => this.handleNotification(notification),
      () => {
        if (this.connection === connection) this.connection = null;
        this.invalidateCaches();
      },
    );
    const connection = session
      .request("initialize", this.startupTimeoutMs, {
        capabilities: { experimentalApi: true },
        clientInfo: {
          name: "chatgato",
          title: "ChatGato",
          version: "0.1.0",
        },
      })
      .then((response) => {
        requireResultObject("initialize", response);
        session.notify("initialized", {});
        return session;
      })
      .catch(async (error: unknown) => {
        if (this.connection === connection) this.connection = null;
        await session.close();
        throw error;
      });
    this.connection = connection;
    return connection;
  }

  private handleNotification(notification: CodexAppServerNotification): void {
    if (
      notification.method.startsWith("thread/") ||
      notification.method.startsWith("turn/") ||
      notification.method.startsWith("item/")
    ) {
      this.threadsCache = undefined;
    }
    if (notification.method === "fs/changed") {
      this.configCache = undefined;
      this.threadsCache = undefined;
    }
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch {
        // One action listener must not break notification delivery to others.
      }
    }
  }

  private invalidateCaches(): void {
    this.configCache = undefined;
    this.modelsCache = undefined;
    this.threadsCache = undefined;
  }
}

/** Shared by every local action in the plugin process. */
export const defaultCodexAppServer = new CodexAppServerClient();

function parseModel(value: unknown): CodexAppServerModel | null {
  const model = asObject(value);
  if (!model) return null;
  const id = model.id;
  if (typeof id !== "string" || !id) return null;
  const supported = Array.isArray(model.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
    : [];
  return {
    id,
    reasoningEfforts: supported.flatMap((option) => {
      const object = asObject(option);
      const effort = object?.reasoningEffort;
      return typeof effort === "string" && effort ? [effort] : [];
    }),
  };
}

function parseThread(
  thread: JsonObject,
  latestTurnValue: unknown,
): CodexAppServerThread | null {
  if (typeof thread.id !== "string" || typeof thread.cwd !== "string") {
    return null;
  }
  const name = typeof thread.name === "string" ? thread.name.trim() : "";
  const preview =
    typeof thread.preview === "string"
      ? (thread.preview.split(/\r?\n/u)[0]?.trim() ?? "")
      : "";
  if (!name && !preview) return null;

  const latestTurn = asObject(latestTurnValue);
  const updatedAtMs = secondsToMilliseconds(thread.updatedAt);
  const turnUpdatedAtMs = Math.max(
    secondsToMilliseconds(latestTurn?.startedAt),
    secondsToMilliseconds(latestTurn?.completedAt),
  );
  return {
    cwd: thread.cwd,
    id: thread.id,
    parentThreadId:
      typeof thread.parentThreadId === "string" ? thread.parentThreadId : null,
    recencyAtMs:
      secondsToMilliseconds(thread.recencyAt) || turnUpdatedAtMs || updatedAtMs,
    rolloutPath: typeof thread.path === "string" ? thread.path : null,
    status: agentStatusFromAppServer(thread.status, latestTurn),
    title: name || preview || "Untitled chat",
    updatedAtMs: Math.max(updatedAtMs, turnUpdatedAtMs),
  };
}

function agentStatusFromAppServer(
  statusValue: unknown,
  turn: JsonObject | null,
): AgentStatus | null {
  const status = asObject(statusValue);
  const runtimeType =
    typeof status?.type === "string" ? status.type.toLowerCase() : "";
  const activeFlags = Array.isArray(status?.activeFlags)
    ? status.activeFlags.filter(
        (flag): flag is string => typeof flag === "string",
      )
    : [];
  const itemStates = Array.isArray(turn?.items)
    ? turn.items.flatMap((item) => {
        const object = asObject(item);
        return object
          ? [object.type, object.status].filter(
              (state): state is string => typeof state === "string",
            )
          : [];
      })
    : [];
  const waitingStates = [...activeFlags, ...itemStates].map((state) =>
    state.toLowerCase(),
  );
  if (waitingStates.some((state) => state.includes("approval"))) {
    return "awaiting-approval";
  }
  if (
    waitingStates.some(
      (state) =>
        state.includes("userinput") ||
        state.includes("user_input") ||
        state.includes("elicitation"),
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
      return runtimeType === "idle" ? "idle" : null;
  }
}

function secondsToMilliseconds(value: unknown): number {
  const seconds = finiteNumber(value);
  return seconds === null ? 0 : seconds * 1_000;
}

function readCursor(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function requireFreshCursor(
  method: string,
  cursor: string | undefined,
  seen: Set<string>,
): void {
  if (!cursor) return;
  if (seen.has(cursor)) {
    throw new Error(`Codex app-server repeated a ${method} cursor`);
  }
  seen.add(cursor);
}

function unrefStream(
  stream: NodeJS.ReadableStream | NodeJS.WritableStream,
): void {
  const unref = (stream as { unref?: () => void }).unref;
  unref?.call(stream);
}

/** Selects only the canonical `codex` account bucket. */
export function usageFromAppServerResult(
  result: unknown,
  updatedAtMs = Date.now(),
): CodexUsageSnapshot | null {
  const object = asObject(result);
  if (!object) return null;

  const multiBucketValue = object.rateLimitsByLimitId;
  let limits: JsonObject | null;
  if (multiBucketValue !== undefined && multiBucketValue !== null) {
    const buckets = asObject(multiBucketValue);
    if (!buckets) return null;
    limits = asObject(buckets.codex);
  } else {
    limits = asObject(object.rateLimits);
    if (limits && !isCanonicalCodexLimit(limits.limitId)) {
      limits = null;
    }
  }
  if (!limits) return null;

  const primary = parseWindow(limits.primary);
  const secondary = parseWindow(limits.secondary);
  const credits = parseCredits(limits.credits ?? object.credits);
  if (!primary && !secondary && !credits?.hasCredits && !credits?.unlimited) {
    return null;
  }

  const planType = limits.planType ?? object.planType;
  return {
    updatedAtMs,
    primary,
    secondary,
    planType: typeof planType === "string" ? planType : null,
    credits,
  };
}

export function defaultCodexExecutable(
  platform = process.platform,
  userHome = homedir(),
): string {
  const candidates =
    platform === "darwin"
      ? [
          "/Applications/ChatGPT.app/Contents/Resources/codex",
          join(
            userHome,
            "Applications",
            "ChatGPT.app",
            "Contents",
            "Resources",
            "codex",
          ),
        ]
      : platform === "win32"
        ? windowsCodexCandidates()
        : [];
  return (
    candidates.find((candidate) => existsSync(candidate)) ??
    (platform === "win32" ? "codex.exe" : "codex")
  );
}

function windowsCodexCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return [];
  return [
    join(localAppData, "Programs", "ChatGPT", "resources", "codex.exe"),
    join(localAppData, "Programs", "ChatGPT", "codex.exe"),
  ];
}

function parseWindow(value: unknown): CodexUsageWindow | null {
  const window = asObject(value);
  if (!window) return null;
  const usedPercent = finiteNumber(window.usedPercent);
  const windowMinutes = finiteNumber(window.windowDurationMins);
  if (usedPercent === null || windowMinutes === null || windowMinutes <= 0) {
    return null;
  }

  const resetsAt = window.resetsAt;
  const resetsAtSeconds =
    resetsAt === null || resetsAt === undefined ? null : finiteNumber(resetsAt);
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    windowMinutes,
    resetsAtMs: resetsAtSeconds === null ? null : resetsAtSeconds * 1_000,
  };
}

function parseCredits(value: unknown): CodexUsageSnapshot["credits"] | null {
  const credits = asObject(value);
  if (!credits) return null;
  const balance = credits.balance;
  return {
    hasCredits: credits.hasCredits === true,
    unlimited: credits.unlimited === true,
    balance: balance === null || balance === undefined ? null : String(balance),
  };
}

function isCanonicalCodexLimit(limitId: unknown): boolean {
  return (
    typeof limitId !== "string" || limitId.trim() === "" || limitId === "codex"
  );
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function requireResultObject(method: string, message: JsonObject): JsonObject {
  const result = asObject(message.result);
  if (!result) throw new Error(`Invalid ${method} result from Codex`);
  return result;
}

function jsonRpcResponseError(message: JsonObject): Error {
  const error = asObject(message.error);
  const code =
    typeof error?.code === "number" || typeof error?.code === "string"
      ? ` (${error.code})`
      : "";
  const detail =
    typeof error?.message === "string"
      ? error.message
      : "Malformed JSON-RPC error";
  return new CodexAppServerResponseError(
    `Codex app-server request ${String(message.id)} failed${code}: ${detail}`,
  );
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    timeout.unref();
  });
}
