import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(
  new URL(
    "../com.marco.chatgato.sdPlugin/scripts/t3-read.mjs",
    import.meta.url,
  ),
);
const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((home) => rm(home, { recursive: true, force: true })),
  );
});

async function fixture(v2 = false) {
  const home = await mkdtemp(join(tmpdir(), "chatgato-t3-' $()-"));
  homes.push(home);
  await mkdir(join(home, "userdata"));
  const db = new DatabaseSync(
    join(home, "userdata", v2 ? "statev2.sqlite" : "state.sqlite"),
  );
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY, workspace_root TEXT, deleted_at TEXT);
    INSERT INTO projection_projects VALUES ('p', '/project', NULL);
    CREATE TABLE projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT, title TEXT,
      worktree_path TEXT, updated_at TEXT, archived_at TEXT, deleted_at TEXT,
      pending_approval_count INTEGER DEFAULT 0, pending_user_input_count INTEGER DEFAULT 0,
      has_actionable_proposed_plan INTEGER DEFAULT 0, latest_turn_id TEXT);
    CREATE TABLE projection_thread_sessions (thread_id TEXT, status TEXT);
    CREATE TABLE projection_turns (row_id INTEGER PRIMARY KEY, thread_id TEXT, turn_id TEXT, state TEXT,
      requested_at TEXT, completed_at TEXT);
  `);
  if (v2)
    db.exec(`
    CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT,
      title TEXT, updated_at TEXT, archived_at TEXT, deleted_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT, ordinal INTEGER,
      status TEXT, completed_at TEXT);
    CREATE TABLE orchestration_v2_projection_runtime_requests (thread_id TEXT, status TEXT, kind TEXT);
  `);
  function add(
    id: string,
    state = "completed",
    overrides: Record<string, unknown> = {},
  ) {
    const at = "2026-10-06T12:00:00.000Z";
    if (v2) {
      db.prepare(
        "INSERT INTO orchestration_v2_projection_threads VALUES (?, 'p', ?, ?, NULL, NULL, ?)",
      ).run(id, `Task ${id}`, at, JSON.stringify(overrides));
      db.prepare(
        "INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, 1, ?, ?)",
      ).run(`run-${id}`, id, state, state === "completed" ? at : null);
    } else {
      db.prepare(
        `INSERT INTO projection_threads (thread_id, project_id, title, updated_at, latest_turn_id) VALUES (?, 'p', ?, ?, ?)`,
      ).run(id, `Task ${id}`, at, `turn-${id}`);
      db.prepare("INSERT INTO projection_thread_sessions VALUES (?, ?)").run(
        id,
        state === "completed" ? "ready" : state,
      );
      db.prepare(
        "INSERT INTO projection_turns (thread_id, turn_id, state, requested_at, completed_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, `turn-${id}`, state, at, state === "completed" ? at : null);
    }
  }
  return { home, db, add };
}

async function read(
  home: string,
  cwdFilter?: string,
  stdin = false,
  useEnvironment = false,
) {
  const options = Buffer.from(
    JSON.stringify({ home: useEnvironment ? undefined : home, cwdFilter }),
  ).toString("base64");
  const script = stdin ? await readFile(scriptPath, "utf8") : undefined;
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      stdin ? ["--input-type=module", "-", options] : [scriptPath, options],
      { env: { ...process.env, T3CODE_HOME: home } },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
    child.stdin!.end(script);
  });
  return JSON.parse(output) as Array<{
    id: string;
    status: string;
    updatedAtMs: number;
    cwd: string;
  }>;
}

describe.each([false, true])("T3 read-only database adapter (v2: %s)", (v2) => {
  it("reads live WAL data and maps running, completed, interrupted, and failed threads", async () => {
    const { home, db, add } = await fixture(v2);
    try {
      add("running", "running");
      add("done");
      add("interrupted", "interrupted");
      add("error", v2 ? "failed" : "error");
      const result = await read(home);
      expect(Object.fromEntries(result.map((t) => [t.id, t.status]))).toEqual({
        running: "working",
        done: "unread",
        interrupted: "idle",
        error: "error",
      });
      expect(result[0]!.updatedAtMs).toBe(
        Date.parse("2026-10-06T12:00:00.000Z"),
      );
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM projection_projects").get(),
      ).toEqual({ count: 1 });
    } finally {
      db.close();
    }
  });

  it("gives approval and input waits priority over working", async () => {
    const { home, db, add } = await fixture(v2);
    try {
      add("approval", "running");
      add("input", "running");
      if (v2)
        db.exec(`
        INSERT INTO orchestration_v2_projection_runtime_requests VALUES ('approval', 'pending', 'command');
        INSERT INTO orchestration_v2_projection_runtime_requests VALUES ('input', 'pending', 'user_input');
      `);
      else
        db.exec(`
        UPDATE projection_threads SET pending_approval_count = 1 WHERE thread_id = 'approval';
        UPDATE projection_threads SET pending_user_input_count = 1 WHERE thread_id = 'input';
      `);
      expect(
        Object.fromEntries((await read(home)).map((t) => [t.id, t.status])),
      ).toEqual({
        approval: "awaiting-approval",
        input: "awaiting-response",
      });
    } finally {
      db.close();
    }
  });

  it("excludes archived/deleted threads and deleted projects, filters before limiting, and preserves worktree membership", async () => {
    const { home, db, add } = await fixture(v2);
    const table = v2
      ? "orchestration_v2_projection_threads"
      : "projection_threads";
    try {
      for (let i = 0; i < 25; i++) add(`task-${String(i).padStart(2, "0")}`);
      add("archived");
      add("deleted");
      add("other-project");
      db.exec(`UPDATE ${table} SET archived_at = '2026-10-06' WHERE thread_id = 'archived';
        UPDATE ${table} SET deleted_at = '2026-10-06' WHERE thread_id = 'deleted';
        INSERT INTO projection_projects VALUES ('other', '/other', '2026-10-06');
        UPDATE ${table} SET project_id = 'other' WHERE thread_id = 'other-project';`);
      const result = await read(home, "/project");
      expect(result).toHaveLength(20);
      expect(result[0]!.id).toBe("task-24");
      expect(await read(home, "/proj")).toEqual([]);
      expect(await read(home, "/")).toHaveLength(20);
      if (v2)
        db.exec(
          `UPDATE ${table} SET payload_json = '{"worktreePath":"/worktree"}' WHERE thread_id = 'task-00'`,
        );
      else
        db.exec(
          `UPDATE ${table} SET worktree_path = '/worktree' WHERE thread_id = 'task-00'`,
        );
      expect((await read(home, "/worktree")).map((t) => t.id)).toEqual([
        "task-00",
      ]);
    } finally {
      db.close();
    }
  });

  it("runs the identical reader through stdin as used over SSH, including custom homes with shell characters", async () => {
    const { home, db, add } = await fixture(v2);
    try {
      add("task");
      expect(await read(home, undefined, true, true)).toEqual(await read(home));
    } finally {
      db.close();
    }
  });
});

it("uses the legacy thread's selected turn even when another turn was requested later", async () => {
  const { home, db, add } = await fixture();
  try {
    add("current", "interrupted");
    db.exec(`
      INSERT INTO projection_turns (thread_id, turn_id, state, requested_at, completed_at)
      VALUES ('current', 'other-turn', 'completed', '2026-10-06T13:00:00.000Z', '2026-10-06T14:00:00.000Z');
    `);
    expect(await read(home)).toEqual([
      {
        id: "current",
        title: "Task current",
        cwd: "/project",
        updatedAtMs: Date.parse("2026-10-06T12:00:00.000Z"),
        status: "idle",
      },
    ]);
  } finally {
    db.close();
  }
});

it("does not reuse a historical completion when a legacy thread has no selected turn", async () => {
  const { home, db, add } = await fixture();
  try {
    add("no-turn");
    db.exec("UPDATE projection_threads SET latest_turn_id = NULL");
    expect(
      (await read(home)).map(({ id, status }) => ({ id, status })),
    ).toEqual([{ id: "no-turn", status: "idle" }]);
  } finally {
    db.close();
  }
});

it("prefers v2 over the retained v1 database, excludes subagents but keeps forks, and honors visits", async () => {
  const { home, db, add } = await fixture(true);
  try {
    const old = new DatabaseSync(join(home, "userdata", "state.sqlite"));
    old.close();
    add("parent", "completed", { lastVisitedAt: "2026-10-06T13:00:00.000Z" });
    add("child", "running", {
      lineage: { parentThreadId: "parent", relationshipToParent: "subagent" },
    });
    add("fork", "running", {
      lineage: { parentThreadId: "parent", relationshipToParent: "fork" },
    });
    expect(
      (await read(home)).map(({ id, status }) => ({ id, status })),
    ).toEqual([
      { id: "parent", status: "idle" },
      { id: "fork", status: "working" },
    ]);
  } finally {
    db.close();
  }
});

it("shows queued v2 runs as working, including after an older completion", async () => {
  const { home, db, add } = await fixture(true);
  try {
    add("queued-only", "queued");
    add("queued-after-completed");
    add("queued-approval", "queued");
    db.exec(`
      INSERT INTO orchestration_v2_projection_runs
      VALUES ('queued-next', 'queued-after-completed', 2, 'queued', NULL);
      INSERT INTO orchestration_v2_projection_runtime_requests
      VALUES ('queued-approval', 'pending', 'command');
    `);
    expect(
      Object.fromEntries((await read(home)).map((t) => [t.id, t.status])),
    ).toEqual({
      "queued-only": "working",
      "queued-after-completed": "working",
      "queued-approval": "awaiting-approval",
    });
  } finally {
    db.close();
  }
});

it("reports missing state without creating a database", async () => {
  const home = await mkdtemp(join(tmpdir(), "chatgato-t3-missing-"));
  homes.push(home);
  await expect(read(home)).rejects.toThrow();
  expect(existsSync(join(home, "userdata", "state.sqlite"))).toBe(false);
});
