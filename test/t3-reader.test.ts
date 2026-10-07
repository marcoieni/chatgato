import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      title TEXT, updated_at TEXT, archived_at TEXT, deleted_at TEXT, payload_json TEXT,
      provider_instance_id TEXT DEFAULT 'provider');
    CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT, ordinal INTEGER,
      status TEXT, completed_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_turn_items (turn_item_id TEXT PRIMARY KEY, thread_id TEXT,
      run_id TEXT, node_id TEXT, type TEXT, status TEXT, updated_at TEXT, ordinal INTEGER, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_provider_sessions (provider_session_id TEXT PRIMARY KEY,
      provider_instance_id TEXT, updated_at TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_provider_session_bindings (provider_session_id TEXT, thread_id TEXT);
    CREATE TABLE orchestration_v2_projection_provider_threads (provider_thread_id TEXT PRIMARY KEY,
      thread_id TEXT, payload_json TEXT);
    CREATE TABLE orchestration_v2_projection_runtime_requests (thread_id TEXT, status TEXT, kind TEXT);
    CREATE TABLE orchestration_v2_projection_plans (plan_id TEXT PRIMARY KEY, thread_id TEXT,
      run_id TEXT, node_id TEXT, kind TEXT, status TEXT, payload_json TEXT);
  `);
  function add(
    id: string,
    state = "completed",
    overrides: Record<string, unknown> = {},
  ) {
    const at = "2026-10-06T12:00:00.000Z";
    if (v2) {
      db.prepare(
        `INSERT INTO orchestration_v2_projection_threads
        (thread_id, project_id, title, updated_at, payload_json) VALUES (?, 'p', ?, ?, ?)`,
      ).run(id, `Task ${id}`, at, JSON.stringify(overrides));
      db.prepare(
        "INSERT INTO orchestration_v2_projection_runs VALUES (?, ?, 1, ?, ?, ?)",
      ).run(
        `run-${id}`,
        id,
        state,
        state === "completed" ? at : null,
        JSON.stringify({
          rootNodeId: `root-${id}`,
          startedAt: state === "queued" ? null : at,
        }),
      );
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
  it("returns the machine's environment identity for exact chat navigation", async () => {
    const { home, db, add } = await fixture(v2);
    try {
      add("exact-thread");
      await writeFile(
        join(home, "userdata", "environment-id"),
        "remote-environment\n",
      );
      expect(await read(home, undefined, true)).toEqual([
        expect.objectContaining({
          id: "exact-thread",
          environmentId: "remote-environment",
        }),
      ]);
    } finally {
      db.close();
    }
  });

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
      (run_id, thread_id, ordinal, status)
      VALUES ('queued-next', 'queued-after-completed', 2, 'queued');
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

async function usageLimitedFixture() {
  const context = await fixture(true);
  context.add("limited", "failed");
  context.db.exec(`
    INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, status, payload_json)
    VALUES ('successor', 'limited', 2, 'queued', '{"startedAt":null}');
    INSERT INTO orchestration_v2_projection_turn_items
    VALUES ('failure', 'limited', 'run-limited', 'root-limited', 'error', 'failed',
      '2026-10-06T12:00:00.000Z', 1,
      '{"failure":{"class":"usage_limit","message":"Plan limit reached."}}');
  `);
  return context;
}

it.each([
  ["queued", null, "error"],
  ["cancelled", null, "error"],
  ["cancelled", "2026-10-06T13:00:00.000Z", "idle"],
  ["completed", "2026-10-06T13:00:00.000Z", "unread"],
  ["preparing", null, "working"],
  ["starting", null, "working"],
  ["running", "2026-10-06T13:00:00.000Z", "working"],
  ["waiting", "2026-10-06T13:00:00.000Z", "working"],
])(
  "preserves a v2 usage limit until a successor executes (%s, started %s)",
  async (state, startedAt, expected) => {
    const { home, db } = await usageLimitedFixture();
    try {
      db.prepare(
        `UPDATE orchestration_v2_projection_runs SET status = ?, payload_json = ?
        WHERE run_id = 'successor'`,
      ).run(state, JSON.stringify({ startedAt }));
      expect((await read(home))[0]!.status).toBe(expected);
    } finally {
      db.close();
    }
  },
);

it.each([
  ["command", "awaiting-approval"],
  ["user_input", "awaiting-response"],
])(
  "prioritizes pending %s requests over a blocked v2 queue",
  async (kind, expected) => {
    const { home, db } = await usageLimitedFixture();
    try {
      db.prepare(
        "INSERT INTO orchestration_v2_projection_runtime_requests VALUES ('limited', 'pending', ?)",
      ).run(kind);
      expect((await read(home))[0]!.status).toBe(expected);
    } finally {
      db.close();
    }
  },
);

it("keeps a real active v2 run working even when a newer queued run follows a limit", async () => {
  const { home, db } = await usageLimitedFixture();
  try {
    db.exec(`
      INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, status)
      VALUES ('active', 'limited', 0, 'running');
    `);
    expect((await read(home))[0]!.status).toBe("working");
  } finally {
    db.close();
  }
});

it.each([
  ["node_id", "subagent-root"],
  ["run_id", "another-run"],
  ["type", "message"],
  ["status", "completed"],
])(
  "does not block a v2 queue on an unrelated error (%s = %s)",
  async (column, value) => {
    const { home, db } = await usageLimitedFixture();
    try {
      db.prepare(
        `UPDATE orchestration_v2_projection_turn_items SET ${column} = ?`,
      ).run(value);
      expect((await read(home))[0]!.status).toBe("working");
    } finally {
      db.close();
    }
  },
);

it.each([
  ["2026-10-06T13:00:00.000Z", 0, "earlier-id"],
  ["2026-10-06T12:00:00.000Z", 2, "earlier-id"],
  ["2026-10-06T12:00:00.000Z", 1, "later-id"],
])(
  "uses the latest failed root error to classify a v2 queue (%s, %s, %s)",
  async (at, ordinal, id) => {
    const { home, db } = await usageLimitedFixture();
    try {
      db.prepare(
        `
      INSERT INTO orchestration_v2_projection_turn_items
      VALUES (?, 'limited', 'run-limited', 'root-limited', 'error', 'failed', ?, ?,
        '{"failure":{"class":"unknown","message":"Plan limit reached."}}')
    `,
      ).run(id, at, ordinal);
      expect((await read(home))[0]!.status).toBe("working");
    } finally {
      db.close();
    }
  },
);

it.each([
  [null, "provider", "error"],
  ["Plan limit reached.", "provider", "error"],
  ["Session connection failed.", "provider", "working"],
  ["Session connection failed.", "old-provider", "error"],
])(
  "only supersedes a v2 limit with a distinct current-provider session error (%s, %s)",
  async (lastError, provider, expected) => {
    const { home, db } = await usageLimitedFixture();
    try {
      db.prepare(
        `
      INSERT INTO orchestration_v2_projection_provider_sessions
      VALUES ('session', ?, '2026-10-06T13:00:00.000Z', ?)
    `,
      ).run(provider, JSON.stringify({ lastError }));
      db.exec(`
      INSERT INTO orchestration_v2_projection_provider_session_bindings VALUES ('session', 'limited');
    `);
      expect((await read(home))[0]!.status).toBe(expected);
    } finally {
      db.close();
    }
  },
);

it.each([
  ["command_execution", "running"],
  ["dynamic_tool", "pending"],
  ["subagent", "waiting"],
])(
  "keeps a completed v2 run working until its background %s completes",
  async (type, status) => {
    const { home, db, add } = await fixture(true);
    try {
      add("background");
      db.prepare(
        `
      INSERT INTO orchestration_v2_projection_turn_items
      (turn_item_id, thread_id, run_id, type, status, payload_json)
      VALUES ('task', 'background', 'run-background', ?, ?, '{}')
    `,
      ).run(type, status);
      expect((await read(home))[0]!.status).toBe("working");
      db.exec(
        "UPDATE orchestration_v2_projection_turn_items SET status = 'completed'",
      );
      expect((await read(home))[0]!.status).toBe("unread");
    } finally {
      db.close();
    }
  },
);

it.each([
  ["subagent", "idle", {}, "unread"],
  ["subagent", "failed", {}, "unread"],
  ["message", "running", {}, "unread"],
  ["dynamic_tool", "running", { input: { persistent: true } }, "unread"],
  ["dynamic_tool", "running", { input: { persistent: 1 } }, "working"],
])(
  "filters inactive and persistent v2 background work (%s, %s, %j)",
  async (type, status, payload, expected) => {
    const { home, db, add } = await fixture(true);
    try {
      add("background");
      db.prepare(
        `
      INSERT INTO orchestration_v2_projection_turn_items
      (turn_item_id, thread_id, run_id, type, status, payload_json)
      VALUES ('task', 'background', 'run-background', ?, ?, ?)
    `,
      ).run(type, status, JSON.stringify(payload));
      expect((await read(home))[0]!.status).toBe(expected);
    } finally {
      db.close();
    }
  },
);

it("ignores rolled-back v2 work while allowing runless background tasks after completion", async () => {
  const { home, db, add } = await fixture(true);
  try {
    add("background", "rolled_back");
    db.exec(`
      INSERT INTO orchestration_v2_projection_runs (run_id, thread_id, ordinal, status)
      VALUES ('current', 'background', 2, 'completed');
      INSERT INTO orchestration_v2_projection_turn_items
      (turn_item_id, thread_id, run_id, type, status, payload_json)
      VALUES ('task', 'background', 'run-background', 'command_execution', 'running', '{}');
    `);
    expect((await read(home))[0]!.status).toBe("unread");
    db.exec("UPDATE orchestration_v2_projection_turn_items SET run_id = NULL");
    expect((await read(home))[0]!.status).toBe("working");
    db.exec(`
      INSERT INTO orchestration_v2_projection_provider_threads
      VALUES ('provider-thread', 'background', '{"pendingBackgroundTasks":[{"taskId":"task"}]}');
      UPDATE orchestration_v2_projection_runs SET status = 'rolled_back' WHERE run_id = 'current';
    `);
    expect((await read(home))[0]!.status).toBe("idle");
    db.exec("DELETE FROM orchestration_v2_projection_runs");
    expect((await read(home))[0]!.status).toBe("idle");
  } finally {
    db.close();
  }
});

it("reads nonempty task IDs only from the selected v2 provider's background roster", async () => {
  const { home, db, add } = await fixture(true);
  try {
    add("background", "completed", { activeProviderThreadId: "active" });
    db.exec(`
      INSERT INTO orchestration_v2_projection_provider_threads VALUES
        ('active', 'background', '{"pendingBackgroundTasks":[{"taskId":""}]}'),
        ('old', 'background', '{"pendingBackgroundTasks":[{"taskId":"old-task"}]}'),
        ('other', 'another-thread', '{"pendingBackgroundTasks":[{"taskId":"other-task"}]}');
    `);
    expect((await read(home))[0]!.status).toBe("unread");
    db.exec(`
      UPDATE orchestration_v2_projection_provider_threads
      SET payload_json = '{"pendingBackgroundTasks":[{"taskId":"active-task"}]}'
      WHERE provider_thread_id = 'active';
    `);
    expect((await read(home))[0]!.status).toBe("working");
    db.exec(`
      UPDATE orchestration_v2_projection_provider_threads
      SET payload_json = '{"pendingBackgroundTasks":[]}' WHERE provider_thread_id = 'active';
    `);
    expect((await read(home))[0]!.status).toBe("unread");
    db.exec(
      "UPDATE orchestration_v2_projection_threads SET payload_json = '{}'",
    );
    expect((await read(home))[0]!.status).toBe("working");
    db.exec(
      "DELETE FROM orchestration_v2_projection_provider_threads WHERE provider_thread_id = 'old'",
    );
    expect((await read(home))[0]!.status).toBe("unread");
  } finally {
    db.close();
  }
});

it("gives v2 failures and requests priority over background work, which outranks plans", async () => {
  const { home, db, add } = await fixture(true);
  try {
    for (const [id, state] of [
      ["failed", "failed"],
      ["approval", "completed"],
      ["input", "completed"],
      ["plan", "completed"],
      ["cancelled", "cancelled"],
      ["interrupted", "interrupted"],
    ] as const) {
      add(id, state, { interactionMode: "plan" });
      db.prepare(
        `
        INSERT INTO orchestration_v2_projection_turn_items
        (turn_item_id, thread_id, type, status, payload_json)
        VALUES (?, ?, 'command_execution', 'running', '{}')
      `,
      ).run(`task-${id}`, id);
    }
    db.exec(`
      INSERT INTO orchestration_v2_projection_runtime_requests VALUES
        ('approval', 'pending', 'command'), ('input', 'pending', 'user_input');
      INSERT INTO orchestration_v2_projection_plans (plan_id, thread_id, kind, status)
      VALUES ('plan', 'plan', 'proposed_plan', 'active');
    `);
    expect(
      Object.fromEntries((await read(home)).map((t) => [t.id, t.status])),
    ).toEqual({
      failed: "error",
      approval: "awaiting-approval",
      input: "awaiting-response",
      plan: "working",
      cancelled: "working",
      interrupted: "working",
    });
  } finally {
    db.close();
  }
});

it("shows active v2 proposed plans as awaiting response while preserving run status priority", async () => {
  const { home, db, add } = await fixture(true);
  try {
    for (const id of ["unseen", "seen", "running", "failed", "no-run"]) {
      add(id, id === "running" || id === "failed" ? id : "completed", {
        interactionMode: "plan",
        ...(id === "seen" ? { lastVisitedAt: "2026-10-06T13:00:00.000Z" } : {}),
      });
      db.prepare(
        `INSERT INTO orchestration_v2_projection_plans (plan_id, thread_id, kind, status)
        VALUES (?, ?, 'proposed_plan', 'active')`,
      ).run(`plan-${id}`, id);
    }
    db.exec(
      "DELETE FROM orchestration_v2_projection_runs WHERE thread_id = 'no-run'",
    );
    expect(
      Object.fromEntries((await read(home)).map((t) => [t.id, t.status])),
    ).toEqual({
      unseen: "awaiting-response",
      seen: "awaiting-response",
      running: "working",
      failed: "error",
      "no-run": "idle",
    });
  } finally {
    db.close();
  }
});

it("ignores inactive v2 plans, todo lists, and plans outside plan mode", async () => {
  const { home, db, add } = await fixture(true);
  try {
    for (const [id, kind, status, interactionMode] of [
      ["draft", "proposed_plan", "draft", "plan"],
      ["superseded", "proposed_plan", "superseded", "plan"],
      ["implemented", "proposed_plan", "completed", "plan"],
      ["todo", "todo_list", "active", "plan"],
      ["default-mode", "proposed_plan", "active", "default"],
    ] as const) {
      add(id, "completed", { interactionMode });
      db.prepare(
        `INSERT INTO orchestration_v2_projection_plans (plan_id, thread_id, kind, status)
        VALUES (?, ?, ?, ?)`,
      ).run(`plan-${id}`, id, kind, status);
    }
    expect(
      Object.fromEntries((await read(home)).map((t) => [t.id, t.status])),
    ).toEqual({
      draft: "unread",
      superseded: "unread",
      implemented: "unread",
      todo: "unread",
      "default-mode": "unread",
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
