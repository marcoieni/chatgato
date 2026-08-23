import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface, type Interface } from "node:readline";
import type { CodexUsageSnapshot, CodexUsageWindow } from "../types.js";

const DEFAULT_STARTUP_TIMEOUT_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const PROCESS_EXIT_GRACE_MS = 250;
const MAX_STDERR_LENGTH = 4_000;

type JsonObject = Record<string, unknown>;

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (message: JsonObject) => void;
  timeout: NodeJS.Timeout;
};

export type CodexAppServerUsageClientOptions = {
  args?: readonly string[];
  executable?: string;
  now?: () => number;
  requestTimeoutMs?: number;
  startupTimeoutMs?: number;
};

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

  constructor(executable: string, args: readonly string[]) {
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
        this.pendingRequests.delete(id);
        reject(new Error(`Codex app-server ${method} timed out`));
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

    if (typeof message.id !== "number") return;
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
 * Reads the authenticated account limits exposed by the installed Codex
 * app-server. Calls on the same client are single-flight so adjacent Stream
 * Deck refreshes cannot launch overlapping Codex processes.
 */
export class CodexAppServerUsageClient {
  private readonly args: readonly string[];
  private readonly executable: string;
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private readonly startupTimeoutMs: number;
  private inFlight: Promise<CodexUsageSnapshot> | null = null;

  constructor(options: CodexAppServerUsageClientOptions = {}) {
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
    if (this.inFlight) return this.inFlight;
    const read = this.readOnce().finally(() => {
      if (this.inFlight === read) this.inFlight = null;
    });
    this.inFlight = read;
    return read;
  };

  private async readOnce(): Promise<CodexUsageSnapshot> {
    const session = new LocalAppServerSession(this.executable, this.args);
    try {
      const initialize = await session.request(
        "initialize",
        this.startupTimeoutMs,
        {
          clientInfo: {
            name: "chatgato",
            title: "ChatGato",
            version: "0.1.0",
          },
        },
      );
      requireResultObject("initialize", initialize);
      session.notify("initialized", {});

      const response = await session.request(
        "account/rateLimits/read",
        this.requestTimeoutMs,
      );
      const result = requireResultObject("account/rateLimits/read", response);
      const usage = usageFromAppServerResult(result, this.now());
      if (!usage) {
        throw new Error("Invalid account/rateLimits/read result from Codex");
      }
      return usage;
    } finally {
      await session.close();
    }
  }
}

/** Selects only the canonical `codex` bucket and maps compatible field casing. */
export function usageFromAppServerResult(
  result: unknown,
  updatedAtMs = Date.now(),
): CodexUsageSnapshot | null {
  const object = asObject(result);
  if (!object) return null;

  const multiBucketValue =
    object.rateLimitsByLimitId ?? object.rate_limits_by_limit_id;
  let limits: JsonObject | null;
  if (multiBucketValue !== undefined && multiBucketValue !== null) {
    const buckets = asObject(multiBucketValue);
    if (!buckets) return null;
    limits = asObject(buckets.codex);
  } else {
    limits = asObject(object.rateLimits ?? object.rate_limits);
    if (
      limits &&
      !isCanonicalCodexLimit(readField(limits, "limitId", "limit_id"))
    ) {
      limits = null;
    }
  }
  if (!limits) return null;

  const primary = parseWindow(readField(limits, "primary"));
  const secondary = parseWindow(readField(limits, "secondary"));
  const credits = parseCredits(
    readField(limits, "credits") ?? readField(object, "credits"),
  );
  if (!primary && !secondary && !credits?.hasCredits && !credits?.unlimited) {
    return null;
  }

  const planType =
    readField(limits, "planType", "plan_type") ??
    readField(object, "planType", "plan_type");
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
  const usedPercent = finiteNumber(
    readField(window, "usedPercent", "used_percent"),
  );
  const windowMinutes = finiteNumber(
    readField(
      window,
      "windowDurationMins",
      "windowMinutes",
      "window_duration_mins",
      "window_minutes",
    ),
  );
  if (usedPercent === null || windowMinutes === null || windowMinutes <= 0) {
    return null;
  }

  const resetsAt = readField(window, "resetsAt", "resets_at");
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
  const balance = readField(credits, "balance");
  return {
    hasCredits: readField(credits, "hasCredits", "has_credits") === true,
    unlimited: readField(credits, "unlimited") === true,
    balance: balance === null || balance === undefined ? null : String(balance),
  };
}

function isCanonicalCodexLimit(limitId: unknown): boolean {
  return (
    typeof limitId !== "string" || limitId.trim() === "" || limitId === "codex"
  );
}

function readField(object: JsonObject, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.hasOwn(object, key)) return object[key];
  }
  return undefined;
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
  return new Error(
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
