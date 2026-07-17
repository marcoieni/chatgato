import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DatabaseSync,
  StatementSync,
  type SQLInputValue,
  type SQLOutputValue,
} from "node:sqlite";
import {
  CodexStore,
  reasoningTargetIndex,
  resolveCodexSqliteHome,
} from "../src/lib/codex-store.js";
import type { RolloutRecord } from "../src/types.js";

const temporaryDirectories: string[] = [];

beforeEach(() => {
  vi.stubEnv("CODEX_SQLITE_HOME", "");
});

function createThreadDatabase(home: string): DatabaseSync {
  const db = new DatabaseSync(join(home, "state_5.sqlite"));
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY, title TEXT, cwd TEXT, rollout_path TEXT,
      updated_at INTEGER, updated_at_ms INTEGER, recency_at_ms INTEGER,
      model TEXT, reasoning_effort TEXT, archived INTEGER, preview TEXT
    );
    CREATE TABLE thread_spawn_edges (
      parent_thread_id TEXT, child_thread_id TEXT PRIMARY KEY, status TEXT
    );
  `);
  return db;
}

type ThreadFixture = {
  archived?: number;
  cwd?: string;
  id: string;
  model?: string | null;
  preview?: string;
  reasoningEffort?: string | null;
  recencyAtMs?: number;
  rolloutPath: string;
  title?: string;
  updatedAt?: number;
  updatedAtMs?: number;
};

function insertThread(db: DatabaseSync, fixture: ThreadFixture): void {
  const title = fixture.title ?? fixture.id;
  const updatedAtMs = fixture.updatedAtMs ?? 1_000;
  db.prepare(
    `
    INSERT INTO threads
    (id, title, cwd, rollout_path, updated_at, updated_at_ms, recency_at_ms, model, reasoning_effort, archived, preview)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    fixture.id,
    title,
    fixture.cwd ?? "/tmp/project",
    fixture.rolloutPath,
    fixture.updatedAt ?? 1,
    updatedAtMs,
    fixture.recencyAtMs ?? updatedAtMs,
    fixture.model === undefined ? "gpt-test" : fixture.model,
    fixture.reasoningEffort === undefined ? "high" : fixture.reasoningEffort,
    fixture.archived ?? 0,
    fixture.preview ?? title,
  );
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("CodexStore", () => {
  it("reads the database from CODEX_SQLITE_HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-home-"));
    const sqliteHome = await mkdtemp(join(tmpdir(), "chatgato-sqlite-"));
    temporaryDirectories.push(home, sqliteHome);
    vi.stubEnv("CODEX_SQLITE_HOME", sqliteHome);

    const db = createThreadDatabase(sqliteHome);
    insertThread(db, {
      id: "environment-thread",
      rolloutPath: join(home, "rollout.jsonl"),
    });
    db.close();

    const store = new CodexStore(home);

    expect(store.sqliteHome).toBe(sqliteHome);
    await expect(store.threadAtSlot(1)).resolves.toMatchObject({
      id: "environment-thread",
    });
  });

  it("prefers the sqlite_home config setting over CODEX_SQLITE_HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-home-"));
    const environmentHome = await mkdtemp(
      join(tmpdir(), "chatgato-environment-sqlite-"),
    );
    const configuredHome = await mkdtemp(
      join(tmpdir(), "chatgato-configured-sqlite-"),
    );
    temporaryDirectories.push(home, environmentHome, configuredHome);
    vi.stubEnv("CODEX_SQLITE_HOME", environmentHome);
    await writeFile(
      join(home, "config.toml"),
      `sqlite_home = ${JSON.stringify(configuredHome)} # SQLite state\n[other]\nsqlite_home = "/ignored"\n`,
    );

    const db = createThreadDatabase(configuredHome);
    insertThread(db, {
      id: "configured-thread",
      rolloutPath: join(home, "rollout.jsonl"),
    });
    db.close();

    const store = new CodexStore(home);

    expect(store.sqliteHome).toBe(configuredHome);
    await expect(store.threadAtSlot(1)).resolves.toMatchObject({
      id: "configured-thread",
    });
  });

  it("resolves relative SQLite locations from the current working directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-home-"));
    temporaryDirectories.push(home);
    await mkdir(join(home, "configured"));
    await writeFile(join(home, "config.toml"), "sqlite_home = 'configured'\n");

    expect(resolveCodexSqliteHome(home, "environment", home)).toBe(
      join(home, "configured"),
    );
  });

  it("reads a recent thread and derives its live status", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-test-"));
    temporaryDirectories.push(home);
    const rollout = join(home, "rollout.jsonl");
    await writeFile(
      rollout,
      [
        { type: "event_msg", payload: { type: "task_started" } },
        {
          type: "response_item",
          payload: { type: "custom_tool_call", name: "exec" },
        },
        {
          timestamp: "2026-07-16T08:00:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            rate_limits: {
              primary: {
                used_percent: 18,
                window_minutes: 300,
                resets_at: 1_784_000_000,
              },
            },
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n"),
    );

    const db = createThreadDatabase(home);
    insertThread(db, {
      id: "thread-1",
      rolloutPath: rollout,
      title: "Test task",
    });
    db.close();
    await writeFile(
      join(home, "models_cache.json"),
      JSON.stringify({
        models: [
          {
            slug: "gpt-test",
            supported_reasoning_levels: ["low", "medium", "high", "xhigh"].map(
              (effort) => ({ effort }),
            ),
          },
        ],
      }),
    );

    const store = new CodexStore(home);
    const thread = await store.threadAtSlot(1);
    expect(thread).toMatchObject({
      id: "thread-1",
      title: "Test task",
      cwd: "/tmp/project",
      reasoningEffort: "high",
      status: "working",
    });
    expect(await store.latestUsage()).toMatchObject({
      updatedAtMs: Date.parse("2026-07-16T08:00:00.000Z"),
      primary: { usedPercent: 18, windowMinutes: 300 },
    });
    await expect(store.reasoningTarget("increase")).resolves.toEqual({
      changed: true,
      effort: "xhigh",
      optionIndex: 3,
    });
    await expect(store.reasoningTarget("decrease", 2)).resolves.toEqual({
      changed: true,
      effort: "low",
      optionIndex: 0,
    });
  });

  it("reads fast mode from Codex's persisted service tier", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-fast-mode-"));
    temporaryDirectories.push(home);
    const store = new CodexStore(home);

    await expect(store.fastModeEnabled()).resolves.toBe(false);

    await writeFile(join(home, "config.toml"), 'service_tier = "fast"\n');
    await expect(store.fastModeEnabled()).resolves.toBe(true);

    await writeFile(join(home, "config.toml"), 'service_tier = "priority"\n');
    await expect(store.fastModeEnabled()).resolves.toBe(true);

    await writeFile(
      join(home, "config.toml"),
      'service_tier = "fast"\n\n[features]\nfast_mode = false\n',
    );
    await expect(store.fastModeEnabled()).resolves.toBe(false);

    await writeFile(
      join(home, "config.toml"),
      'service_tier = "default"\n\n[features]\nfast_mode = true\n',
    );
    await expect(store.fastModeEnabled()).resolves.toBe(false);
  });

  it("hydrates only the thread selected for a slot", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-test-"));
    temporaryDirectories.push(home);
    const db = createThreadDatabase(home);
    for (let slot = 1; slot <= 6; slot += 1) {
      insertThread(db, {
        id: `thread-${slot}`,
        recencyAtMs: 1_000 - slot,
        rolloutPath: join(home, `rollout-${slot}.jsonl`),
        title: `Task ${slot}`,
        updatedAtMs: 1_000 - slot,
      });
    }
    db.close();

    const readRolloutTail = vi.fn(
      async (_path: string): Promise<RolloutRecord[]> => [],
    );
    const store = new CodexStore(home, readRolloutTail);

    await expect(store.threadAtSlot(4)).resolves.toMatchObject({
      id: "thread-4",
    });
    expect(readRolloutTail).toHaveBeenCalledOnce();
    expect(readRolloutTail).toHaveBeenCalledWith(join(home, "rollout-4.jsonl"));
  });

  it("continues scanning global recency rows until it finds a workspace match", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-test-"));
    temporaryDirectories.push(home);
    const db = createThreadDatabase(home);
    for (let rank = 1; rank <= 40; rank += 1) {
      insertThread(db, {
        cwd: "/tmp/other-project",
        id: `other-${rank}`,
        recencyAtMs: 1_000 - rank,
        rolloutPath: join(home, `other-${rank}.jsonl`),
        title: `Other ${rank}`,
        updatedAtMs: 1_000 - rank,
      });
    }
    insertThread(db, {
      id: "matching-thread",
      recencyAtMs: 959,
      rolloutPath: join(home, "matching.jsonl"),
      title: "Matching task",
      updatedAtMs: 959,
    });
    db.close();

    const store = new CodexStore(home);

    await expect(store.threadAtSlot(1, "/tmp/project")).resolves.toMatchObject({
      id: "matching-thread",
    });
  });

  it("uses one database cursor when a workspace filter has no matches", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-test-"));
    temporaryDirectories.push(home);
    const db = createThreadDatabase(home);
    for (let rank = 1; rank <= 200; rank += 1) {
      insertThread(db, {
        cwd: "/tmp/other-project",
        id: `other-${rank}`,
        recencyAtMs: 1_000 - rank,
        rolloutPath: join(home, `other-${rank}.jsonl`),
        updatedAtMs: 1_000 - rank,
      });
    }
    db.close();

    const iterate = vi.spyOn(StatementSync.prototype, "iterate");
    const all = vi.spyOn(StatementSync.prototype, "all");
    const store = new CodexStore(home);

    await expect(store.threadAtSlot(1, "/tmp/project")).resolves.toBeNull();
    expect(iterate).toHaveBeenCalledOnce();
    expect(all).not.toHaveBeenCalled();
  });

  it("keeps thread ordering stable while Codex updates the database", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-test-"));
    temporaryDirectories.push(home);
    const databasePath = join(home, "state_5.sqlite");
    const db = createThreadDatabase(home);
    db.exec("PRAGMA journal_mode = WAL");
    for (let rank = 1; rank <= 36; rank += 1) {
      insertThread(db, {
        cwd: "/tmp/other-project",
        id: `other-${rank}`,
        recencyAtMs: 1_000 - rank,
        rolloutPath: join(home, `other-${rank}.jsonl`),
        updatedAtMs: 1_000 - rank,
      });
    }
    insertThread(db, {
      id: "matching-thread",
      recencyAtMs: 963,
      rolloutPath: join(home, "matching.jsonl"),
      title: "Matching task",
      updatedAtMs: 963,
    });
    db.close();

    const writer = new DatabaseSync(databasePath);
    const originalIterate = StatementSync.prototype.iterate;
    let reordered = false;
    vi.spyOn(StatementSync.prototype, "iterate").mockImplementation(function (
      this: StatementSync,
      namedParameters?: Record<string, SQLInputValue>,
      ...anonymousParameters: SQLInputValue[]
    ) {
      const parameters =
        namedParameters === undefined
          ? []
          : [namedParameters, ...anonymousParameters];
      const iterate = originalIterate as (
        ...values: Array<SQLInputValue | Record<string, SQLInputValue>>
      ) => NodeJS.Iterator<Record<string, SQLOutputValue>>;
      const rows = iterate.apply(this, parameters);
      return (function* (): Generator<
        Record<string, SQLOutputValue>,
        undefined
      > {
        let visited = 0;
        for (const row of rows) {
          visited += 1;
          if (visited === 36) {
            writer.prepare("DELETE FROM threads WHERE id = ?").run("other-1");
            reordered = true;
          }
          yield row;
        }
        return undefined;
      })();
    });

    try {
      const store = new CodexStore(home);
      await expect(
        store.threadAtSlot(1, "/tmp/project"),
      ).resolves.toMatchObject({
        id: "matching-thread",
      });
      expect(reordered).toBe(true);
    } finally {
      writer.close();
    }
  });

  it("clamps reasoning changes at the model's supported boundaries", () => {
    const efforts = ["low", "medium", "high", "xhigh"];
    expect(reasoningTargetIndex(efforts, "xhigh", "increase")).toBe(3);
    expect(reasoningTargetIndex(efforts, "low", "decrease")).toBe(0);
    expect(reasoningTargetIndex(efforts, "low", "increase", 3)).toBe(3);
  });
});
