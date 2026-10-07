import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_AGENT_SLOTS } from "./agent-slots.js";
import {
  T3Connections,
  isT3SshHost,
  type T3Connection,
} from "./t3-connections.js";
import { T3DesktopCache } from "./t3-desktop-cache.js";
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
    settings.t3Home?.trim() || "",
    settings.cwdFilter?.trim() || "",
  ]);
}

export function t3SshArguments(
  host: string,
  encodedOptions: string,
  port?: number,
): string[] {
  // SSH interprets leading options, and forwards the command through a shell.
  // Keep the destination a single host/alias and the payload base64-only.
  if (!isT3SshHost(host)) {
    throw new Error("T3 Code SSH host must be an SSH alias or user@hostname");
  }
  if (!/^[a-z0-9+/]+=*$/i.test(encodedOptions)) {
    throw new Error("Invalid T3 Code reader options");
  }
  if (
    port !== undefined &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  )
    throw new Error("Invalid T3 Code SSH port");
  return [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ForwardAgent=no",
    "-o",
    "PermitLocalCommand=no",
    ...(port === undefined ? [] : ["-p", String(port)]),
    host,
    `node --input-type=module - ${encodedOptions}`,
  ];
}

export type T3ThreadSource = {
  environmentId?: string;
  host?: string;
  port?: number;
  home?: string;
  cwdFilter?: string;
};

const desktopCache = new T3DesktopCache();

async function readThreads(source: T3ThreadSource): Promise<CodexThread[]> {
  if (source.environmentId)
    return desktopCache.read(source.environmentId, source.cwdFilter);
  const options = Buffer.from(
    JSON.stringify({
      home: source.home,
      cwdFilter: source.cwdFilter,
    }),
  ).toString("base64");
  const host = source.host;
  const args = host
    ? t3SshArguments(host, options, source.port)
    : [readerPath, options];
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
      id: value.id,
      t3ThreadRef: {
        threadId: value.id,
        ...(typeof value.environmentId === "string" && value.environmentId
          ? { environmentId: value.environmentId }
          : {}),
      },
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

  constructor(
    private readonly read = readThreads,
    private readonly discoverHosts: (
      home?: string,
    ) => Promise<T3Connection[]> = new T3Connections().discover,
  ) {}

  private async recentThreads(settings: AgentSettings): Promise<CodexThread[]> {
    const cwdFilter = settings.cwdFilter?.trim() || undefined;
    const local: T3ThreadSource = {
      home: settings.t3Home?.trim() || undefined,
      cwdFilter,
    };
    const readSource = async (source: T3ThreadSource) =>
      (await this.read(source)).map((thread) => ({
        ...thread,
        // A thread's identity is independent of slots and workspace filters.
        id: source.environmentId
          ? `t3:${JSON.stringify(["relay", source.environmentId, thread.id])}`
          : `t3:${JSON.stringify([source.host ?? "", source.port ?? "", source.home ?? "", thread.id])}`,
      }));
    const connections = await this.discoverHosts(local.home);
    const sources = [
      local,
      ...connections.map((connection) => ({ ...connection, cwdFilter })),
    ];
    const results = await Promise.allSettled(sources.map(readSource));
    return successfulThreads(results)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs || a.id.localeCompare(b.id))
      .slice(0, MAX_AGENT_SLOTS);
  }

  async threadAtSlot(
    slot: number,
    settings: AgentSettings,
  ): Promise<CodexThread | null> {
    const key = t3SourceKey(settings);
    let cached = this.cache.get(key);
    if (!cached || cached.expiresAtMs <= Date.now()) {
      // Share the merged read across keys, including in-flight SSH reads.
      for (const [key, entry] of this.cache) {
        if (entry.expiresAtMs <= Date.now()) this.cache.delete(key);
      }
      cached = { expiresAtMs: Infinity, threads: this.recentThreads(settings) };
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

function successfulThreads(
  results: PromiseSettledResult<CodexThread[]>[],
): CodexThread[] {
  const successful = results.filter((result) => result.status === "fulfilled");
  if (results.length > 0 && successful.length === 0) {
    throw new AggregateError(
      results.map((result) => (result as PromiseRejectedResult).reason),
      "Unable to read T3 Code threads from any machine",
    );
  }
  return successful.flatMap((result) => result.value);
}
