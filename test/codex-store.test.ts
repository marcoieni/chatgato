import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CodexStore,
  reasoningTargetIndex,
  resolveCodexSqliteHome,
} from "../src/lib/codex-store.js";
import type {
  CodexAppServerClientLike,
  CodexAppServerThread,
} from "../src/lib/codex-app-server.js";
import type { RemoteThreadRow } from "../src/lib/remote-codex-store.js";
import type { RolloutRecord } from "../src/types.js";

const temporaryDirectories: string[] = [];

beforeEach(() => {
  vi.stubEnv("CODEX_SQLITE_HOME", "");
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function temporaryHome(prefix = "chatgato-store-"): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(home);
  return home;
}

function thread(
  id: string,
  overrides: Partial<CodexAppServerThread> = {},
): CodexAppServerThread {
  return {
    cwd: "/tmp/project",
    id,
    parentThreadId: null,
    recencyAtMs: 1_000,
    rolloutPath: null,
    status: "unread",
    title: id,
    updatedAtMs: 1_000,
    ...overrides,
  };
}

function appServer(
  overrides: Partial<CodexAppServerClientLike> = {},
): CodexAppServerClientLike {
  return {
    readConfig: vi.fn(async () => ({})),
    readModels: vi.fn(async () => []),
    readThreads: vi.fn(async () => []),
    readAccountUsage: vi.fn(async () => ({
      dailyUsageBuckets: null,
      summary: {
        currentStreakDays: null,
        lifetimeTokens: null,
        longestRunningTurnSeconds: null,
        longestStreakDays: null,
        peakDailyTokens: null,
      },
      updatedAtMs: 0,
    })),
    readUsage: vi.fn(async () => ({
      credits: null,
      planType: null,
      primary: null,
      rateLimitReachedType: null,
      resetCredits: null,
      secondary: null,
      updatedAtMs: 0,
    })),
    subscribe: vi.fn(() => () => undefined),
    ...overrides,
  };
}

function store(
  home: string,
  server: CodexAppServerClientLike,
  readRolloutTail: (path: string) => Promise<RolloutRecord[]> = async () => [],
  readRemoteThreads: (
    home: string,
  ) => Promise<RemoteThreadRow[]> = async () => [],
  readRemoteFastMode: (
    home: string,
    forceRefresh?: boolean,
  ) => Promise<{ enabled: boolean; selectionId: string } | null> = async () =>
    null,
): CodexStore {
  return new CodexStore({
    appServer: server,
    codexHome: home,
    readRemoteFastMode,
    readRemoteThreads,
    readRolloutTail,
  });
}

function createReasoningDatabase(
  home: string,
  fixture: { effort?: string; id?: string; model?: string } = {},
): void {
  const db = new DatabaseSync(join(home, "state_5.sqlite"));
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      model TEXT,
      reasoning_effort TEXT,
      archived INTEGER,
      recency_at_ms INTEGER
    )
  `);
  db.prepare(
    `INSERT INTO threads
       (id, model, reasoning_effort, archived, recency_at_ms)
     VALUES (?, ?, ?, 0, 1000)`,
  ).run(
    fixture.id ?? "reasoning-thread",
    fixture.model ?? "gpt-current",
    fixture.effort ?? "medium",
  );
  db.close();
}

describe("CodexStore", () => {
  it("uses app-server metadata and rollout detail for ambiguous active state", async () => {
    const home = await temporaryHome();
    const rootPath = join(home, "root.jsonl");
    const readRolloutTail = vi.fn(
      async (path: string): Promise<RolloutRecord[]> =>
        path === rootPath
          ? [{ type: "event_msg", payload: { type: "exec_approval_request" } }]
          : [],
    );
    const server = appServer({
      readConfig: vi.fn(async () => ({ service_tier: "fast" })),
      readThreads: vi.fn(async () => [
        thread("root", {
          recencyAtMs: 2_000,
          rolloutPath: rootPath,
          status: "working",
          title: "Official metadata",
          updatedAtMs: 2_000,
        }),
        thread("child", {
          parentThreadId: "root",
          rolloutPath: join(home, "child.jsonl"),
          status: "unread",
        }),
      ]),
    });
    const subject = store(home, server, readRolloutTail);

    await expect(subject.threadAtSlot(1)).resolves.toMatchObject({
      id: "root",
      status: "awaiting-approval",
      subtaskStatuses: ["unread"],
      title: "Official metadata",
    });
    await expect(subject.fastModeEnabled()).resolves.toBe(true);
    expect(readRolloutTail).toHaveBeenCalledOnce();
  });

  it("uses definitive app-server status without reading a rollout", async () => {
    const home = await temporaryHome();
    const readRolloutTail = vi.fn(async () => []);
    const subject = store(
      home,
      appServer({
        readThreads: vi.fn(async () => [
          thread("done", {
            rolloutPath: join(home, "done.jsonl"),
            status: "unread",
          }),
        ]),
      }),
      readRolloutTail,
    );

    await expect(subject.threadAtSlot(1)).resolves.toMatchObject({
      id: "done",
      status: "unread",
    });
    expect(readRolloutTail).not.toHaveBeenCalled();
  });

  it("falls back to the rollout for an inconclusive app-server status", async () => {
    const home = await temporaryHome();
    const rolloutPath = join(home, "active.jsonl");
    const readRolloutTail = vi.fn(async (): Promise<RolloutRecord[]> => [
      { type: "event_msg", payload: { type: "task_started" } },
    ]);
    const subject = store(
      home,
      appServer({
        readThreads: vi.fn(async () => [
          thread("active", { rolloutPath, status: null }),
        ]),
      }),
      readRolloutTail,
    );

    await expect(subject.threadAtSlot(1)).resolves.toMatchObject({
      id: "active",
      status: "working",
    });
    expect(readRolloutTail).toHaveBeenCalledWith(rolloutPath);
  });

  it("surfaces app-server discovery failures instead of reading SQLite", async () => {
    const home = await temporaryHome();
    createReasoningDatabase(home);
    const subject = store(
      home,
      appServer({
        readThreads: vi.fn(async () => {
          throw new Error("current protocol unavailable");
        }),
      }),
    );

    await expect(subject.threadAtSlot(1)).rejects.toThrow(
      "current protocol unavailable",
    );
  });

  it("recovers approval permissions that fall outside the rollout tail", async () => {
    const home = await temporaryHome();
    const rolloutPath = join(home, "large-rollout.jsonl");
    const records: RolloutRecord[] = [
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "developer",
          content: [
            {
              type: "input_text",
              text: `## Approved command prefixes\n- ["git", "push"]`,
            },
          ],
        },
      },
      {
        type: "event_msg",
        payload: { type: "token_count", padding: "x".repeat(600 * 1024) },
      },
      {
        type: "response_item",
        payload: {
          type: "custom_tool_call",
          name: "exec",
          call_id: "approved-push",
          input:
            'const result = await tools.exec_command({"cmd":"git push","sandbox_permissions":"require_escalated"});',
        },
      },
    ];
    await writeFile(
      rolloutPath,
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    );
    const server = appServer({
      readThreads: vi.fn(async () => [
        thread("large-rollout", { rolloutPath, status: "working" }),
      ]),
    });
    const subject = new CodexStore({
      appServer: server,
      codexHome: home,
      readRemoteFastMode: async () => null,
      readRemoteThreads: async () => [],
    });

    await expect(subject.threadAtSlot(1)).resolves.toMatchObject({
      id: "large-rollout",
      status: "working",
    });
  });

  it("finds a duplicate title's position in Codex task search", async () => {
    const home = await temporaryHome();
    const sharedPrefix = "x".repeat(200);
    const subject = store(
      home,
      appServer({
        readThreads: vi.fn(async () => [
          thread("long-a", { recencyAtMs: 5_000, title: `${sharedPrefix}A` }),
          thread("long-b", { recencyAtMs: 4_000, title: `${sharedPrefix}B` }),
          thread("duplicate-a", {
            recencyAtMs: 3_000,
            title: "Remote chat",
          }),
          thread("duplicate-b", {
            recencyAtMs: 2_000,
            title: "Remote chat",
          }),
        ]),
      }),
    );

    await expect(subject.threadSearchResult("duplicate-b")).resolves.toEqual({
      resultIndex: 1,
      title: "Remote chat",
    });
    await expect(subject.threadSearchResult("long-b")).resolves.toEqual({
      resultIndex: 1,
      title: `${sharedPrefix}B`,
    });
  });

  it("uses model/list with SQLite only for the active task's selection", async () => {
    const home = await temporaryHome();
    createReasoningDatabase(home);
    const subject = store(
      home,
      appServer({
        readModels: vi.fn(async () => [
          {
            id: "gpt-current",
            reasoningEfforts: ["low", "medium", "high"],
          },
        ]),
      }),
    );

    await expect(subject.reasoningSnapshot()).resolves.toEqual({
      currentEffort: "medium",
      efforts: ["low", "medium", "high"],
      model: "gpt-current",
      threadId: "reasoning-thread",
    });
  });

  it("does not fall back to models_cache.json", async () => {
    const home = await temporaryHome();
    createReasoningDatabase(home);
    await writeFile(
      join(home, "models_cache.json"),
      JSON.stringify({
        models: [
          {
            slug: "gpt-current",
            supported_reasoning_levels: [{ effort: "medium" }],
          },
        ],
      }),
    );
    const subject = store(
      home,
      appServer({
        readModels: vi.fn(async () => {
          throw new Error("model/list unavailable");
        }),
      }),
    );

    await expect(subject.reasoningSnapshot()).rejects.toThrow(
      "model/list unavailable",
    );
  });

  it("resolves the remaining SQLite path from current configuration", async () => {
    const home = await temporaryHome();
    const configuredHome = join(home, "configured");
    await writeFile(
      join(home, "config.toml"),
      `sqlite_home = ${JSON.stringify(configuredHome)} # current state\n`,
    );

    expect(resolveCodexSqliteHome(home, join(home, "environment"), home)).toBe(
      configuredHome,
    );
    await writeFile(join(home, "config.toml"), "sqlite_home = 'relative'\n");
    expect(resolveCodexSqliteHome(home, undefined, home)).toBe(
      join(home, "relative"),
    );
  });

  it("reads Fast mode only from config/read", async () => {
    const home = await temporaryHome();
    let config: Record<string, unknown> = {};
    const readConfig = vi.fn(async () => config);
    const subject = store(home, appServer({ readConfig }));

    await expect(subject.fastModeEnabled()).resolves.toBe(false);
    config = { service_tier: "fast" };
    await expect(subject.fastModeEnabled()).resolves.toBe(true);
    config = { service_tier: "priority" };
    await expect(subject.fastModeEnabled()).resolves.toBe(true);
    config = { features: { fast_mode: false }, service_tier: "fast" };
    await expect(subject.fastModeEnabled()).resolves.toBe(false);
    config = { features: { fast_mode: true }, service_tier: "default" };
    await expect(subject.fastModeEnabled()).resolves.toBe(false);
  });

  it("uses the selected remote host's Fast mode", async () => {
    const home = await temporaryHome();
    const readRemoteFastMode = vi.fn(async () => ({
      enabled: true,
      selectionId: "remote:selected-project",
    }));
    const subject = store(
      home,
      appServer({
        readConfig: vi.fn(async () => ({ service_tier: "default" })),
      }),
      async () => [],
      async () => [],
      readRemoteFastMode,
    );

    await expect(subject.fastModeEnabled()).resolves.toBe(true);
    await expect(subject.fastModeEnabled(true)).resolves.toBe(true);
    expect(readRemoteFastMode).toHaveBeenLastCalledWith(home, true);
  });

  it("keeps local Fast mode when remote state is unavailable", async () => {
    const home = await temporaryHome();
    const subject = store(
      home,
      appServer({
        readConfig: vi.fn(async () => ({ service_tier: "fast" })),
      }),
      async () => [],
      async () => [],
      async () => {
        throw new Error("remote host offline");
      },
    );

    await expect(subject.fastModeStates()).resolves.toEqual({
      localEnabled: true,
      remoteEnabled: null,
      selectionId: "local",
    });
  });

  it("reads Plan mode from the latest app-server task's rollout", async () => {
    const home = await temporaryHome();
    const currentPath = join(home, "current.jsonl");
    const readRolloutTail = vi.fn(
      async (path: string): Promise<RolloutRecord[]> =>
        path === currentPath
          ? [
              {
                type: "turn_context",
                payload: { collaboration_mode: { mode: "plan" } },
              },
            ]
          : [],
    );
    const subject = store(
      home,
      appServer({
        readThreads: vi.fn(async () => [
          thread("current", {
            recencyAtMs: 2_000,
            rolloutPath: currentPath,
          }),
          thread("older", {
            recencyAtMs: 1_000,
            rolloutPath: join(home, "older.jsonl"),
          }),
        ]),
      }),
      readRolloutTail,
    );

    await expect(subject.planModeEnabled()).resolves.toBe(true);
    expect(readRolloutTail).toHaveBeenCalledOnce();
    expect(readRolloutTail).toHaveBeenCalledWith(currentPath);
  });

  it("does not use SQLite to replace a missing Plan-mode rollout", async () => {
    const home = await temporaryHome();
    createReasoningDatabase(home);
    const readRolloutTail = vi.fn(async () => []);
    const subject = store(
      home,
      appServer({ readThreads: vi.fn(async () => [thread("current")]) }),
      readRolloutTail,
    );

    await expect(subject.planModeEnabled()).resolves.toBe(false);
    expect(readRolloutTail).not.toHaveBeenCalled();
  });

  it("hydrates only the task selected for a slot", async () => {
    const home = await temporaryHome();
    const threads = Array.from({ length: 6 }, (_, index) =>
      thread(`thread-${index + 1}`, {
        recencyAtMs: 1_000 - index,
        rolloutPath: join(home, `rollout-${index + 1}.jsonl`),
        status: null,
      }),
    );
    const readRolloutTail = vi.fn(async () => []);
    const subject = store(
      home,
      appServer({ readThreads: vi.fn(async () => threads) }),
      readRolloutTail,
    );

    await expect(subject.threadAtSlot(4)).resolves.toMatchObject({
      id: "thread-4",
    });
    expect(readRolloutTail).toHaveBeenCalledOnce();
    expect(readRolloutTail).toHaveBeenCalledWith(join(home, "rollout-4.jsonl"));
  });

  it("excludes subagents from slots and reports them on their parent", async () => {
    const home = await temporaryHome();
    const subject = store(
      home,
      appServer({
        readThreads: vi.fn(async () => [
          thread("child", {
            parentThreadId: "parent",
            recencyAtMs: 2_000,
            status: "unread",
          }),
          thread("parent", { recencyAtMs: 1_000, status: "idle" }),
        ]),
      }),
    );

    await expect(subject.threadAtSlot(1)).resolves.toMatchObject({
      id: "parent",
      status: "idle",
      subtaskStatuses: ["unread"],
    });
    await expect(subject.threadAtSlot(2)).resolves.toBeNull();
  });

  it("merges remote and local tasks by recency", async () => {
    const home = await temporaryHome();
    const readRemoteThreads = vi.fn(async (): Promise<RemoteThreadRow[]> => [
      {
        cwd: "/home/user/work",
        id: "remote",
        recencyAtMs: 3_000,
        remoteHostId: "remote-ssh-discovered:devbox",
        remotePlatform: "posix",
        rolloutPath: null,
        status: "unread",
        title: "Remote chat",
        updatedAtMs: 3_100,
      },
    ]);
    const subject = store(
      home,
      appServer({
        readThreads: vi.fn(async () => [
          thread("local", { recencyAtMs: 2_000, status: "idle" }),
        ]),
      }),
      async () => [],
      readRemoteThreads,
    );

    await expect(subject.threadAtSlot(1)).resolves.toMatchObject({
      id: "remote",
      remoteHostId: "remote-ssh-discovered:devbox",
    });
    await expect(subject.threadAtSlot(2)).resolves.toMatchObject({
      id: "local",
    });
    expect(readRemoteThreads).toHaveBeenCalledOnce();
  });

  it("matches nested Windows remote workspaces case-insensitively", async () => {
    const home = await temporaryHome();
    const subject = store(
      home,
      appServer(),
      async () => [],
      async () => [
        {
          cwd: "c:\\WORK\\repo",
          id: "windows-remote",
          recencyAtMs: 3_000,
          remoteHostId: "windows-host",
          remotePlatform: "windows",
          rolloutPath: null,
          status: "unread",
          title: "Windows remote chat",
          updatedAtMs: 3_100,
        },
      ],
    );

    await expect(subject.threadAtSlot(1, "C:\\work")).resolves.toMatchObject({
      id: "windows-remote",
    });
  });

  it("shares an in-flight task refresh across slots", async () => {
    const home = await temporaryHome();
    let finishRead!: (threads: CodexAppServerThread[]) => void;
    const pending = new Promise<CodexAppServerThread[]>((resolve) => {
      finishRead = resolve;
    });
    const readThreads = vi.fn(() => pending);
    const subject = store(home, appServer({ readThreads }));

    const first = subject.threadAtSlot(1);
    await vi.waitFor(() => expect(readThreads).toHaveBeenCalledOnce());
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    const second = subject.threadAtSlot(1);
    finishRead([thread("local", { status: "idle" })]);

    await expect(first).resolves.toMatchObject({ id: "local" });
    await expect(second).resolves.toMatchObject({ id: "local" });
    expect(readThreads).toHaveBeenCalledOnce();
  });

  it("scans the full app-server result for a workspace match", async () => {
    const home = await temporaryHome();
    const threads = [
      ...Array.from({ length: 40 }, (_, index) =>
        thread(`other-${index}`, {
          cwd: "/tmp/other-project",
          recencyAtMs: 2_000 - index,
        }),
      ),
      thread("matching", { cwd: "/tmp/project", recencyAtMs: 1_000 }),
    ];
    const subject = store(
      home,
      appServer({ readThreads: vi.fn(async () => threads) }),
    );

    await expect(
      subject.threadAtSlot(1, "/tmp/project"),
    ).resolves.toMatchObject({ id: "matching" });
  });

  it("clamps reasoning changes at the model's supported boundaries", () => {
    const efforts = ["low", "medium", "high", "xhigh"];
    expect(reasoningTargetIndex(efforts, "xhigh", "increase")).toBe(3);
    expect(reasoningTargetIndex(efforts, "low", "decrease")).toBe(0);
    expect(reasoningTargetIndex(efforts, "low", "increase", 3)).toBe(3);
  });
});
