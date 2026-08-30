import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import {
  asObject,
  type CodexAppServerNotification,
  type JsonObject,
} from "./codex-app-server-protocol.js";

const PROCESS_EXIT_GRACE_MS = 250;
const MAX_STDERR_LENGTH = 4_000;

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (message: JsonObject) => void;
  timeout: NodeJS.Timeout;
};

type RequestOptions = {
  fatalTimeout?: boolean;
};

export class CodexAppServerResponseError extends Error {
  constructor(
    message: string,
    readonly code: number | string | null,
  ) {
    super(message);
  }
}

export function isFatalProtocolResponseError(error: unknown): boolean {
  return (
    error instanceof CodexAppServerResponseError &&
    typeof error.code === "number" &&
    error.code >= -32700 &&
    error.code <= -32600
  );
}

export class LocalAppServerSession {
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
    options: RequestOptions = {},
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
        if (options.fatalTimeout !== false) this.fail(error);
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

function jsonRpcResponseError(message: JsonObject): Error {
  const error = asObject(message.error);
  const codeValue = error?.code;
  const code =
    typeof codeValue === "number" || typeof codeValue === "string"
      ? codeValue
      : null;
  const codeDetail = code === null ? "" : ` (${code})`;
  const detail =
    typeof error?.message === "string"
      ? error.message
      : "Malformed JSON-RPC error";
  return new CodexAppServerResponseError(
    `Codex app-server request ${String(message.id)} failed${codeDetail}: ${detail}`,
    code,
  );
}

function unrefStream(
  stream: NodeJS.ReadableStream | NodeJS.WritableStream,
): void {
  const unref = (stream as { unref?: () => void }).unref;
  unref?.call(stream);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    timeout.unref();
  });
}
