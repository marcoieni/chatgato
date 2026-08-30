import { join } from "node:path";
import { defaultCodexExecutable } from "./codex-executable.js";
import {
  asObject,
  parseAppServerModel,
  parseAppServerThread,
  requireResultObject,
  usageFromAppServerResult,
  type CodexAppServerClientLike,
  type CodexAppServerModel,
  type CodexAppServerNotification,
  type CodexAppServerThread,
  type JsonObject,
} from "./codex-app-server-protocol.js";
import {
  CodexAppServerResponseError,
  isFatalProtocolResponseError,
  LocalAppServerSession,
} from "./codex-app-server-session.js";
import type { CodexUsageSnapshot } from "../types.js";

export { defaultCodexExecutable } from "./codex-executable.js";
export { usageFromAppServerResult } from "./codex-app-server-protocol.js";
export type {
  CodexAppServerClientLike,
  CodexAppServerModel,
  CodexAppServerNotification,
  CodexAppServerThread,
} from "./codex-app-server-protocol.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const THREADS_PER_PAGE = 100;
const THREAD_TURN_STATUS_LIMIT = 40;
const THREAD_CACHE_MS = 1_000;
const CONFIG_CACHE_MS = 750;
const MODEL_CACHE_MS = 5 * 60_000;
const CONFIG_WATCH_ID = "chatgato-config";
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

type VersionedInFlight<T> = {
  generation: number;
  promise: Promise<T>;
};

export type CodexAppServerClientOptions = {
  args?: readonly string[];
  executable?: string;
  now?: () => number;
  requestTimeoutMs?: number;
  startupTimeoutMs?: number;
};

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
  private configGeneration = 0;
  private configInFlight: VersionedInFlight<JsonObject> | null = null;
  private configPath: string | null = null;
  private configWatchRoot: string | null = null;
  private modelsCache:
    { expiresAtMs: number; value: CodexAppServerModel[] } | undefined;
  private modelsGeneration = 0;
  private modelsInFlight: VersionedInFlight<CodexAppServerModel[]> | null =
    null;
  private threadsCache:
    { expiresAtMs: number; value: CodexAppServerThread[] } | undefined;
  private threadsGeneration = 0;
  private threadsInFlight: VersionedInFlight<CodexAppServerThread[]> | null =
    null;
  private usageGeneration = 0;
  private usageInFlight: VersionedInFlight<CodexUsageSnapshot> | null = null;

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
    const generation = this.usageGeneration;
    if (this.usageInFlight) {
      return this.followInvalidatedRead(
        this.usageInFlight,
        generation,
        this.readUsage,
      );
    }
    const read = this.readUsageOnce().finally(() => {
      if (this.usageInFlight?.promise === read) this.usageInFlight = null;
    });
    this.usageInFlight = { generation, promise: read };
    return read;
  };

  readonly readConfig = (): Promise<JsonObject> => {
    const generation = this.configGeneration;
    const now = this.now();
    if (this.configCache && this.configCache.expiresAtMs > now) {
      return Promise.resolve(this.configCache.value);
    }
    if (this.configInFlight) {
      return this.followInvalidatedRead(
        this.configInFlight,
        generation,
        this.readConfig,
      );
    }
    const read = this.requestResult("config/read", {
      includeLayers: false,
    })
      .then((result) => {
        const config = asObject(result.config);
        if (!config) throw new Error("Invalid config/read result from Codex");
        if (generation === this.configGeneration) {
          this.configCache = {
            expiresAtMs: this.now() + CONFIG_CACHE_MS,
            value: config,
          };
        }
        return config;
      })
      .finally(() => {
        if (this.configInFlight?.promise === read) this.configInFlight = null;
      });
    this.configInFlight = { generation, promise: read };
    return read;
  };

  readonly readModels = (): Promise<CodexAppServerModel[]> => {
    const generation = this.modelsGeneration;
    const now = this.now();
    if (this.modelsCache && this.modelsCache.expiresAtMs > now) {
      return Promise.resolve(this.modelsCache.value);
    }
    if (this.modelsInFlight) {
      return this.followInvalidatedRead(
        this.modelsInFlight,
        generation,
        this.readModels,
      );
    }
    const read = this.readModelsOnce()
      .then((models) => {
        if (generation === this.modelsGeneration) {
          this.modelsCache = {
            expiresAtMs: this.now() + MODEL_CACHE_MS,
            value: models,
          };
        }
        return models;
      })
      .finally(() => {
        if (this.modelsInFlight?.promise === read) this.modelsInFlight = null;
      });
    this.modelsInFlight = { generation, promise: read };
    return read;
  };

  readonly readThreads = (): Promise<CodexAppServerThread[]> => {
    const generation = this.threadsGeneration;
    const now = this.now();
    if (this.threadsCache && this.threadsCache.expiresAtMs > now) {
      return Promise.resolve(this.threadsCache.value);
    }
    if (this.threadsInFlight) {
      return this.followInvalidatedRead(
        this.threadsInFlight,
        generation,
        this.readThreads,
      );
    }
    const read = this.readThreadsOnce()
      .then((threads) => {
        if (generation === this.threadsGeneration) {
          this.threadsCache = {
            expiresAtMs: this.now() + THREAD_CACHE_MS,
            value: threads,
          };
        }
        return threads;
      })
      .finally(() => {
        if (this.threadsInFlight?.promise === read) this.threadsInFlight = null;
      });
    this.threadsInFlight = { generation, promise: read };
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
    this.configPath = null;
    this.configWatchRoot = null;
    this.invalidateCaches();
    if (!connection) return;
    const session = await connection.catch(() => null);
    await session?.close();
  }

  private followInvalidatedRead<T>(
    inFlight: VersionedInFlight<T>,
    generation: number,
    readFresh: () => Promise<T>,
  ): Promise<T> {
    return inFlight.generation === generation
      ? inFlight.promise
      : inFlight.promise.then(readFresh, readFresh);
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
        const model = parseAppServerModel(value);
        if (model) models.push(model);
      }
      cursor = readCursor(result.nextCursor);
      requireFreshCursor("model/list", cursor, seenCursors);
    } while (cursor);
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
            try {
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
            } catch (error) {
              if (
                !(error instanceof CodexAppServerResponseError) ||
                isFatalProtocolResponseError(error)
              ) {
                throw error;
              }
              return null;
            }
          }),
        )
      ).filter((entry) => entry !== null),
    );

    return rawThreads
      .map((thread) =>
        parseAppServerThread(
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
    const connection = this.session();
    const session = await connection;
    try {
      const response = await session.request(
        method,
        this.requestTimeoutMs,
        params,
      );
      return requireResultObject(method, response);
    } catch (error) {
      if (!(error instanceof CodexAppServerResponseError)) {
        this.clearConnection(connection);
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
        this.clearConnection(connection);
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
        const result = requireResultObject("initialize", response);
        session.notify("initialized", {});
        void this.registerConfigWatch(session, result).catch(() => undefined);
        return session;
      })
      .catch(async (error: unknown) => {
        this.clearConnection(connection);
        await session.close();
        throw error;
      });
    this.connection = connection;
    return connection;
  }

  private async registerConfigWatch(
    session: LocalAppServerSession,
    initializeResult: JsonObject,
  ): Promise<void> {
    this.configWatchRoot = null;
    this.configPath = null;
    const codexHome = initializeResult.codexHome;
    if (typeof codexHome !== "string" || !codexHome) return;
    this.configWatchRoot = codexHome;
    this.configPath = join(codexHome, "config.toml");
    const response = await session.request(
      "fs/watch",
      this.requestTimeoutMs,
      {
        path: codexHome,
        watchId: CONFIG_WATCH_ID,
      },
      { fatalTimeout: false },
    );
    requireResultObject("fs/watch", response);
  }

  private clearConnection(connection: Promise<LocalAppServerSession>): void {
    if (this.connection !== connection) return;
    this.connection = null;
    this.configPath = null;
    this.configWatchRoot = null;
    this.invalidateCaches();
  }

  private handleNotification(notification: CodexAppServerNotification): void {
    if (
      notification.method.startsWith("thread/") ||
      notification.method.startsWith("turn/") ||
      notification.method.startsWith("item/")
    ) {
      this.invalidateThreads();
    }
    if (notification.method === "fs/changed") {
      if (!this.isConfigChange(notification.params)) return;
      this.invalidateConfig();
      this.invalidateModels();
    }
    if (notification.method === "account/rateLimits/updated") {
      this.usageGeneration += 1;
    }
    if (notification.method === "account/updated") {
      this.invalidateModels();
    }
    for (const listener of this.listeners) {
      try {
        listener(notification);
      } catch {
        // One action listener must not break notification delivery to others.
      }
    }
  }

  private isConfigChange(params: JsonObject): boolean {
    const changedPaths = params.changedPaths;
    if (!Array.isArray(changedPaths)) return true;
    return changedPaths.some(
      (path) => path === this.configPath || path === this.configWatchRoot,
    );
  }

  private invalidateConfig(): void {
    this.configGeneration += 1;
    this.configCache = undefined;
  }

  private invalidateModels(): void {
    this.modelsGeneration += 1;
    this.modelsCache = undefined;
  }

  private invalidateThreads(): void {
    this.threadsGeneration += 1;
    this.threadsCache = undefined;
  }

  private invalidateCaches(): void {
    this.invalidateConfig();
    this.invalidateModels();
    this.invalidateThreads();
    this.usageGeneration += 1;
  }
}

/** Shared by every local action in the plugin process. */
export const defaultCodexAppServer = new CodexAppServerClient();

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

function positiveTimeout(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback;
}
