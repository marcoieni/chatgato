import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentSettings, AgentStatus, CodexThread } from "../types.js";

const readerPath = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  "scripts",
  "t3-read.mjs",
);
const statuses = new Set<AgentStatus>([
  "working",
  "unread",
  "idle",
  "awaiting-approval",
  "awaiting-response",
  "error",
]);

export function t3SourceKey(settings: AgentSettings): string {
  return JSON.stringify([
    settings.t3SshHost?.trim() || "",
    settings.t3Home?.trim() || "",
    settings.cwdFilter?.trim() || "",
  ]);
}

export function t3SshArguments(host: string, encodedOptions: string): string[] {
  // SSH interprets leading options, and forwards the command through a shell.
  // Keep the destination a single host/alias and the payload base64-only.
  if (!/^[a-z0-9_][a-z0-9_.@:[\]-]*$/i.test(host)) {
    throw new Error("T3 Code SSH host must be an SSH alias or user@hostname");
  }
  if (!/^[a-z0-9+/]+=*$/i.test(encodedOptions)) {
    throw new Error("Invalid T3 Code reader options");
  }
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "StrictHostKeyChecking=yes",
    host,
    `node --input-type=module - ${encodedOptions}`,
  ];
}

async function readThreads(settings: AgentSettings): Promise<CodexThread[]> {
  const options = Buffer.from(
    JSON.stringify({
      home: settings.t3Home?.trim(),
      cwdFilter: settings.cwdFilter?.trim(),
    }),
  ).toString("base64");
  const host = settings.t3SshHost?.trim();
  const args = host ? t3SshArguments(host, options) : [readerPath, options];
  const script = host ? await readFile(readerPath, "utf8") : undefined;
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      host ? "ssh" : process.execPath,
      args,
      {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error)
          reject(
            new Error(
              `T3 Code status read failed: ${stderr.trim() || error.message}`,
            ),
          );
        else resolve(stdout);
      },
    );
    // A failed SSH connection can close stdin before the script is sent.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(script);
  });
  const rows: unknown = JSON.parse(output);
  if (!Array.isArray(rows) || rows.length > 20) {
    throw new Error("Invalid T3 Code status response");
  }
  return rows.map((row: unknown) => {
    if (!row || typeof row !== "object")
      throw new Error("Invalid T3 Code thread");
    const value = row as Record<string, unknown>;
    if (
      typeof value.id !== "string" ||
      typeof value.title !== "string" ||
      typeof value.cwd !== "string" ||
      typeof value.updatedAtMs !== "number" ||
      !Number.isFinite(value.updatedAtMs) ||
      !statuses.has(value.status as AgentStatus)
    ) {
      throw new Error("Invalid T3 Code thread");
    }
    return {
      id: `t3:${t3SourceKey(settings)}:${value.id}`,
      title: value.title,
      cwd: value.cwd,
      updatedAtMs: value.updatedAtMs,
      status: value.status as AgentStatus,
      rolloutPath: null,
      reasoningEffort: null,
      spawnStatus: null,
    };
  });
}

export class T3Store {
  private readonly cache = new Map<
    string,
    {
      expiresAtMs: number;
      threads: Promise<CodexThread[]>;
    }
  >();

  constructor(private readonly read = readThreads) {}

  async threadAtSlot(
    slot: number,
    settings: AgentSettings,
  ): Promise<CodexThread | null> {
    const key = t3SourceKey(settings);
    let cached = this.cache.get(key);
    if (!cached || cached.expiresAtMs <= Date.now()) {
      // Share each host read across keys, including in-flight SSH reads.
      for (const [key, entry] of this.cache) {
        if (entry.expiresAtMs <= Date.now()) this.cache.delete(key);
      }
      cached = { expiresAtMs: Infinity, threads: this.read(settings) };
      this.cache.set(key, cached);
      const entry = cached;
      void entry.threads.then(
        () => {
          entry.expiresAtMs = Date.now() + 1_000;
        },
        () => {
          entry.expiresAtMs = Date.now() + 1_000;
        },
      );
    }
    return (await cached.threads)[slot - 1] ?? null;
  }
}
