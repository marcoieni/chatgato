import { readFileSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { usageFromRollout } from "./codex-usage.js";
import { inferRolloutStatus, parseRolloutLines } from "./rollout-status.js";
import type {
  CodexThread,
  CodexUsageSnapshot,
  RolloutRecord,
} from "../types.js";

type ThreadRow = {
  id: string;
  title: string;
  cwd: string;
  rollout_path: string;
  updated_at_ms: number;
  reasoning_effort: string | null;
  spawn_status: string | null;
};

type RolloutPathRow = {
  rollout_path: string;
};

type ReasoningRow = {
  id: string;
  model: string | null;
  reasoning_effort: string | null;
};

type ModelsCache = {
  models?: Array<{
    slug?: unknown;
    supported_reasoning_levels?: Array<{ effort?: unknown }>;
  }>;
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

const TAIL_BYTES = 512 * 1024;

type RolloutTailReader = (path: string) => Promise<RolloutRecord[]>;

export class CodexStore {
  readonly codexHome: string;
  readonly sqliteHome: string;

  constructor(
    codexHome = process.env.CODEX_HOME || join(homedir(), ".codex"),
    private readonly readRolloutTail: RolloutTailReader = readRolloutTailFromFile,
  ) {
    this.codexHome = codexHome;
    this.sqliteHome = resolveCodexSqliteHome(codexHome);
  }

  async recentThreads(limit = 12, cwdFilter?: string): Promise<CodexThread[]> {
    return Promise.all(
      this.recentThreadRows(limit, cwdFilter).map((row) =>
        this.hydrateThread(row),
      ),
    );
  }

  async threadAtSlot(
    slot: number,
    cwdFilter?: string,
  ): Promise<CodexThread | null> {
    const row = this.recentThreadRows(slot, cwdFilter)[slot - 1];
    return row ? this.hydrateThread(row) : null;
  }

  private recentThreadRows(limit: number, cwdFilter?: string): ThreadRow[] {
    const rowLimit = Number.isFinite(limit)
      ? Math.max(0, Math.trunc(limit))
      : 0;
    if (rowLimit === 0) return [];
    const filter = cwdFilter?.trim() ? resolve(cwdFilter.trim()) : null;
    return this.withDatabase((db) => {
      const statement = db.prepare(
        `SELECT t.id, t.title, t.cwd, t.rollout_path,
                COALESCE(t.updated_at_ms, t.updated_at * 1000) AS updated_at_ms,
                t.reasoning_effort,
                e.status AS spawn_status
           FROM threads t
      LEFT JOIN thread_spawn_edges e ON e.child_thread_id = t.id
          WHERE t.archived = 0 AND t.preview <> ''
       ORDER BY t.recency_at_ms DESC, t.id DESC`,
      );
      const selected: ThreadRow[] = [];

      for (const row of statement.iterate() as unknown as Iterable<ThreadRow>) {
        if (filter) {
          const cwd = resolve(row.cwd);
          if (cwd !== filter && !cwd.startsWith(`${filter}${sep}`)) continue;
        }
        selected.push(row);
        if (selected.length === rowLimit) break;
      }

      return selected;
    });
  }

  private async hydrateThread(row: ThreadRow): Promise<CodexThread> {
    return {
      id: row.id,
      title: row.title || "Untitled task",
      cwd: row.cwd,
      rolloutPath: row.rollout_path,
      updatedAtMs: Number(row.updated_at_ms) || 0,
      reasoningEffort: row.reasoning_effort,
      spawnStatus: row.spawn_status,
      status: inferRolloutStatus(
        await this.readRolloutTail(row.rollout_path),
        row.spawn_status,
      ),
    };
  }

  async latestUsage(limit = 12): Promise<CodexUsageSnapshot | null> {
    const rows = this.withDatabase(
      (db) =>
        db
          .prepare(
            `SELECT rollout_path
             FROM threads
            WHERE rollout_path <> ''
         ORDER BY recency_at_ms DESC, id DESC
            LIMIT ?`,
          )
          .all(Math.max(1, limit)) as unknown as RolloutPathRow[],
    );

    const snapshots = await Promise.all(
      rows.map(async (row) =>
        usageFromRollout(await this.readRolloutTail(row.rollout_path)),
      ),
    );
    return (
      snapshots
        .filter((snapshot): snapshot is CodexUsageSnapshot => snapshot !== null)
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs)[0] ?? null
    );
  }

  async fastModeEnabled(): Promise<boolean> {
    let config: string;
    try {
      config = await readFile(join(this.codexHome, "config.toml"), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }

    const serviceTier = readRootTomlString(config, "service_tier");
    const featureEnabled = readTomlBoolean(config, "features", "fast_mode");
    // Codex CLI documents "fast"; the desktop app currently persists the same mode as
    // "priority". Accept both representations so the Stream Deck state follows either surface.
    return (
      (serviceTier === "fast" || serviceTier === "priority") &&
      featureEnabled !== false
    );
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
      throw new Error("The current Codex task has no reasoning setting");
    }

    const cache = JSON.parse(
      await readFile(join(this.codexHome, "models_cache.json"), "utf8"),
    ) as ModelsCache;
    const model = cache.models?.find(
      (candidate) => candidate.slug === row.model,
    );
    const efforts = (model?.supported_reasoning_levels ?? [])
      .map((level) => level.effort)
      .filter(
        (effort): effort is string =>
          typeof effort === "string" && effort.length > 0,
      );
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

function readTomlBoolean(
  config: string,
  table: string,
  key: string,
): boolean | undefined {
  const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const tablePattern = new RegExp(
    `^\\[\\s*(?:${escapedTable}|"${escapedTable}"|'${escapedTable}')\\s*\\](?:\\s*#.*)?$`,
    "u",
  );
  const assignmentPattern = new RegExp(
    `^(?:${escapedKey}|"${escapedKey}"|'${escapedKey}')\\s*=\\s*(true|false)(?:\\s*#.*)?$`,
    "u",
  );
  let inTable = false;

  for (const line of config.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) {
      inTable = tablePattern.test(trimmed);
      continue;
    }
    if (!inTable) continue;

    const assignment = assignmentPattern.exec(trimmed);
    if (assignment) return assignment[1] === "true";
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

async function readRolloutTailFromFile(path: string): Promise<RolloutRecord[]> {
  try {
    const info = await stat(path);
    const length = Math.min(info.size, TAIL_BYTES);
    const start = Math.max(0, info.size - length);
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return parseRolloutLines(buffer.subarray(0, bytesRead).toString("utf8"));
    } finally {
      await handle.close();
    }
  } catch {
    return [];
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
