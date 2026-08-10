import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RemoteCodexStore,
  readThreadsFromHost,
  remoteAgentStatus,
  type RemoteRolloutTailReader,
} from "../src/lib/remote-codex-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function fakeSshScript(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "chatgato-fake-ssh-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "fake-ssh.mjs");
  await writeFile(path, `#!/usr/bin/env node\n${source}`);
  await chmod(path, 0o755);
  return path;
}

describe("remote Codex chat discovery", () => {
  it("reads each configured SSH project's chats", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-remote-state-"));
    temporaryDirectories.push(home);
    await writeFile(
      join(home, ".codex-global-state.json"),
      JSON.stringify({
        "codex-managed-remote-connections": [
          {
            hostId: "remote-ssh-discovered:devbox",
            alias: "devbox",
            sshPort: null,
            identity: null,
          },
        ],
        "remote-projects": [
          {
            hostId: "remote-ssh-discovered:devbox",
            remotePath: "/srv/work",
          },
        ],
        "thread-project-assignments": {
          "remote-thread": {
            projectKind: "remote",
            hostId: "remote-ssh-discovered:devbox",
            path: "/srv/work",
            cwd: "/srv/work/nested",
          },
        },
      }),
    );
    const readHost = vi.fn(async (connection, paths) => [
      {
        cwd: "/srv/work",
        id: "remote-thread",
        recencyAtMs: 2_000,
        remoteHostId: connection.hostId,
        remotePlatform: "posix" as const,
        rolloutPath: "/remote/rollout.jsonl",
        status: "unread" as const,
        title: paths[0]!,
        updatedAtMs: 2_100,
      },
    ]);

    const store = new RemoteCodexStore(readHost);
    await expect(store.readThreadRows(home)).resolves.toEqual([
      expect.objectContaining({
        id: "remote-thread",
        remoteHostId: "remote-ssh-discovered:devbox",
      }),
    ]);
    expect(readHost).toHaveBeenCalledOnce();
    expect(readHost).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: "devbox",
        hostId: "remote-ssh-discovered:devbox",
      }),
      ["/srv/work", "/srv/work/nested"],
    );
  });

  it("keeps caches and failures isolated between store instances", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-remote-state-"));
    temporaryDirectories.push(home);
    await writeFile(
      join(home, ".codex-global-state.json"),
      JSON.stringify({
        "codex-managed-remote-connections": [
          { hostId: "shared-host", alias: "shared-host" },
        ],
        "remote-projects": [
          { hostId: "shared-host", remotePath: "/work/shared" },
        ],
      }),
    );
    const row = {
      cwd: "/work/shared",
      recencyAtMs: 1,
      remoteHostId: "shared-host",
      remotePlatform: "posix" as const,
      rolloutPath: null,
      status: "idle" as const,
      title: "Shared",
      updatedAtMs: 1,
    };
    const healthyStore = new RemoteCodexStore(async () => [
      { ...row, id: "healthy-thread" },
    ]);
    const failingStore = new RemoteCodexStore(async () => {
      throw new Error("offline");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(healthyStore.readThreadRows(home)).resolves.toEqual([
      expect.objectContaining({ id: "healthy-thread" }),
    ]);
    await expect(failingStore.readThreadRows(home)).resolves.toEqual([]);
    expect(healthyStore.hostFailures()).toEqual([]);
    expect(failingStore.hostFailures()).toEqual([
      expect.objectContaining({ hostId: "shared-host", message: "offline" }),
    ]);
  });

  it("keeps available hosts when another SSH host is offline", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-remote-state-"));
    temporaryDirectories.push(home);
    await writeFile(
      join(home, ".codex-global-state.json"),
      JSON.stringify({
        "codex-managed-remote-connections": [
          { hostId: "host-a", alias: "host-a" },
          { hostId: "host-b", alias: "host-b" },
        ],
        "remote-projects": [
          { hostId: "host-a", remotePath: "/work/a" },
          { hostId: "host-b", remotePath: "/work/b" },
        ],
      }),
    );
    const readHost = vi.fn(async (connection) => {
      if (connection.hostId === "host-a") throw new Error("offline");
      return [
        {
          cwd: "/work/b",
          id: "thread-b",
          recencyAtMs: 1,
          remoteHostId: connection.hostId,
          remotePlatform: "posix" as const,
          rolloutPath: "/rollout-b",
          status: "idle" as const,
          title: "B",
          updatedAtMs: 1,
        },
      ];
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const store = new RemoteCodexStore(readHost);
    await expect(store.readThreadRows(home)).resolves.toEqual([
      expect.objectContaining({ id: "thread-b" }),
    ]);
    expect(store.hostFailures()).toContainEqual(
      expect.objectContaining({
        hostId: "host-a",
        kind: "transport",
        message: "offline",
      }),
    );
  });

  it("returns a healthy host without waiting for an unresponsive host", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-remote-state-"));
    temporaryDirectories.push(home);
    await writeFile(
      join(home, ".codex-global-state.json"),
      JSON.stringify({
        "codex-managed-remote-connections": [
          { hostId: "stalled-host", alias: "stalled-host" },
          { hostId: "healthy-host", alias: "healthy-host" },
        ],
        "remote-projects": [
          { hostId: "stalled-host", remotePath: "/work/stalled" },
          { hostId: "healthy-host", remotePath: "/work/healthy" },
        ],
      }),
    );
    const never = new Promise<never>(() => undefined);
    const readHost = vi.fn(async (connection) => {
      if (connection.hostId === "stalled-host") return never;
      return [
        {
          cwd: "/work/healthy/nested",
          id: "healthy-thread",
          recencyAtMs: 1,
          remoteHostId: connection.hostId,
          remotePlatform: "posix" as const,
          rolloutPath: "/healthy.jsonl",
          status: "working" as const,
          title: "Healthy",
          updatedAtMs: 1,
        },
      ];
    });

    const startedAt = performance.now();
    const store = new RemoteCodexStore(readHost);
    await expect(store.readThreadRows(home)).resolves.toEqual([
      expect.objectContaining({ id: "healthy-thread" }),
    ]);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });

  it("serves cached rows while refreshing a host independently", async () => {
    const home = await mkdtemp(join(tmpdir(), "chatgato-remote-state-"));
    temporaryDirectories.push(home);
    await writeFile(
      join(home, ".codex-global-state.json"),
      JSON.stringify({
        "codex-managed-remote-connections": [
          { hostId: "cached-host", alias: "cached-host" },
        ],
        "remote-projects": [
          { hostId: "cached-host", remotePath: "/work/cached" },
        ],
      }),
    );
    const never = new Promise<never>(() => undefined);
    let reads = 0;
    const readHost = vi.fn(async (connection) => {
      reads += 1;
      if (reads > 1) return never;
      return [
        {
          cwd: "/work/cached",
          id: "cached-thread",
          recencyAtMs: 1,
          remoteHostId: connection.hostId,
          remotePlatform: "posix" as const,
          rolloutPath: "/cached.jsonl",
          status: "idle" as const,
          title: "Cached",
          updatedAtMs: 1,
        },
      ];
    });

    vi.useFakeTimers();
    try {
      const store = new RemoteCodexStore(readHost);
      await expect(store.readThreadRows(home)).resolves.toEqual([
        expect.objectContaining({ id: "cached-thread" }),
      ]);
      await vi.advanceTimersByTimeAsync(1_001);
      await expect(store.readThreadRows(home)).resolves.toEqual([
        expect.objectContaining({ id: "cached-thread" }),
      ]);
      expect(readHost).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("paginates all threads, groups subagents, and derives persisted status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chatgato-fake-ssh-"));
    temporaryDirectories.push(directory);
    const fakeSsh = join(directory, "fake-ssh.mjs");
    await writeFile(
      fakeSsh,
      `#!/usr/bin/env node
if (!process.argv.includes("app-server")) {
  process.stdout.write(
    String.fromCharCode(30) + "0\\n" +
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "event_msg",
      payload: { type: "exec_approval_request" }
    }) + "\\n"
  );
  process.exit(0);
}
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 0) {
    send({ id: 0, result: { userAgent: "fake" } });
  } else if (message.method === "thread/list") {
    if ("cwd" in message.params) {
      send({ id: message.id, error: { code: -32602, message: "cwd must be omitted" } });
      return;
    }
    if (!message.params.cursor) {
      send({ id: message.id, result: {
        data: [{
          id: "outside-thread",
          name: "Outside",
          cwd: "/srv/elsewhere",
          path: "/outside.jsonl",
          updatedAt: 13,
          recencyAt: 13,
          status: { type: "notLoaded" }
        }],
        nextCursor: "second-page"
      } });
      return;
    }
    send({ id: message.id, result: { data: [
      {
        id: "remote-subagent",
        name: "Remote subagent",
        cwd: "/srv/work/project",
        parentThreadId: "remote-thread",
        source: { subAgent: { thread_spawn: {
          parent_thread_id: "remote-thread",
          depth: 1,
          agent_path: null,
          agent_nickname: "researcher",
          agent_role: null
        } } },
        path: "/home/user/.codex/subagent.jsonl",
        updatedAt: 14,
        recencyAt: 14,
        status: { type: "active" }
      },
      {
        id: "remote-thread",
        name: "Remote chat",
        preview: "Fallback title",
        cwd: "/srv/work/project",
        path: "/home/user/.codex/rollout.jsonl",
        updatedAt: 12,
        recencyAt: 11,
        status: { type: "notLoaded" }
      }
    ], nextCursor: null } });
  } else if (message.method === "thread/turns/list") {
    send({ id: message.id, result: { data: [
      { status: "interrupted", items: [] }
    ] } });
  }
});
`,
    );
    await chmod(fakeSsh, 0o755);

    await expect(
      readThreadsFromHost(
        {
          destination: "devbox",
          hostId: "remote-ssh-discovered:devbox",
        },
        ["/srv/work"],
        fakeSsh,
      ),
    ).resolves.toEqual([
      {
        cwd: "/srv/work/project",
        id: "remote-thread",
        recencyAtMs: 11_000,
        remoteHostId: "remote-ssh-discovered:devbox",
        remotePlatform: "posix",
        rolloutPath: "/home/user/.codex/rollout.jsonl",
        status: "awaiting-approval",
        subtaskStatuses: ["working"],
        title: "Remote chat",
        updatedAtMs: 12_000,
      },
    ]);
  });

  it("keeps app-server threads that do not have a rollout path", async () => {
    const fakeSsh = await fakeSshScript(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 0) {
    send({ id: 0, result: { userAgent: "fake" } });
  } else if (message.method === "thread/list") {
    send({ id: message.id, result: { data: [{
      id: "memory-thread",
      name: "In-memory chat",
      cwd: "/srv/work/project",
      path: null,
      updatedAt: 12,
      recencyAt: 11,
      status: { type: "active", activeFlags: ["waitingOnUserInput"] }
    }], nextCursor: null } });
  } else if (message.method === "thread/turns/list") {
    send({ id: message.id, result: { data: [{ status: "inProgress" }] } });
  }
});
`);
    const readRollouts = vi.fn(async () => new Map());

    await expect(
      readThreadsFromHost(
        { destination: "devbox", hostId: "null-path" },
        ["/srv/work"],
        fakeSsh,
        readRollouts,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "memory-thread",
        rolloutPath: null,
        status: "awaiting-response",
      }),
    ]);
    expect(readRollouts).not.toHaveBeenCalled();
  });

  it("caps rollout hydration across projects to the visible slot count", async () => {
    const fakeSsh = await fakeSshScript(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const threads = Array.from({ length: 30 }, (_, index) => ({
  id: "thread-" + index,
  name: "Chat " + index,
  cwd: index % 2 === 0 ? "/srv/a/repo" : "/srv/b/repo",
  path: "/rollout-" + index + ".jsonl",
  updatedAt: 30 - index,
  recencyAt: 30 - index,
  status: { type: "notLoaded" }
}));
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 0) {
    send({ id: 0, result: { userAgent: "fake" } });
  } else if (message.method === "thread/list") {
    send({ id: message.id, result: { data: threads, nextCursor: null } });
  } else if (message.method === "thread/turns/list") {
    send({ id: message.id, result: { data: [{ status: "completed" }] } });
  }
});
`);
    const readRollouts = vi.fn<RemoteRolloutTailReader>(
      async (_connection, paths) => new Map(paths.map((path) => [path, []])),
    );

    const rows = await readThreadsFromHost(
      { destination: "devbox", hostId: "many-projects" },
      ["/srv/a", "/srv/b"],
      fakeSsh,
      readRollouts,
    );

    expect(rows).toHaveLength(20);
    expect(rows.map((row) => row.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `thread-${index}`),
    );
    expect(readRollouts).toHaveBeenCalledOnce();
    expect(readRollouts.mock.calls[0]?.[1]).toHaveLength(20);
  });

  it("correlates concurrent turn responses by request id", async () => {
    const fakeSsh = await fakeSshScript(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
const turnRequests = [];
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 0) {
    send({ id: 0, result: { userAgent: "fake" } });
  } else if (message.method === "thread/list") {
    send({ id: message.id, result: { data: [
      {
        id: "thread-a",
        name: "A",
        cwd: "/srv/work/a",
        path: "/a.jsonl",
        recencyAt: 2
      },
      {
        id: "thread-b",
        name: "B",
        cwd: "/srv/work/b",
        path: "/b.jsonl",
        recencyAt: 1
      }
    ], nextCursor: null } });
  } else if (message.method === "thread/turns/list") {
    turnRequests.push(message);
    if (turnRequests.length === 2) {
      for (const request of turnRequests.reverse()) {
        send({ id: request.id, result: { data: [{
          status: request.params.threadId === "thread-a"
            ? "completed"
            : "interrupted"
        }] } });
      }
    }
  }
});
`);

    await expect(
      readThreadsFromHost(
        { destination: "devbox", hostId: "out-of-order" },
        ["/srv/work"],
        fakeSsh,
        async () => new Map(),
      ),
    ).resolves.toEqual([
      expect.objectContaining({ id: "thread-a", status: "unread" }),
      expect.objectContaining({ id: "thread-b", status: "error" }),
    ]);
  });

  it("uses Windows paths and PowerShell rollout retrieval on Windows hosts", async () => {
    const fakeSsh = await fakeSshScript(`
if (!process.argv.includes("app-server")) {
  const command = process.argv.at(-1) ?? "";
  if (!command.startsWith("powershell.exe ") || command.includes("tail -c") || command.includes("sh -c")) {
    process.stderr.write("expected a PowerShell rollout reader");
    process.exit(2);
  }
  process.stdout.write(
    String.fromCharCode(30) + "0\\n" +
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "event_msg",
      payload: { type: "request_user_input" }
    }) + "\\n"
  );
  process.exit(0);
}
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 0) {
    send({
      id: 0,
      result: {
        userAgent: "fake",
        platformFamily: "windows",
        platformOs: "windows"
      }
    });
  } else if (message.method === "thread/list") {
    send({ id: message.id, result: { data: [
      {
        id: "windows-thread",
        name: "Windows chat",
        cwd: "c:\\\\WORK\\\\repo",
        path: "C:\\\\Users\\\\dev\\\\.codex\\\\rollout.jsonl",
        updatedAt: 12,
        recencyAt: 11,
        status: { type: "notLoaded" }
      },
      {
        id: "outside-thread",
        name: "Outside",
        cwd: "C:\\\\workbench",
        path: "C:\\\\outside.jsonl",
        updatedAt: 13,
        recencyAt: 13,
        status: { type: "notLoaded" }
      }
    ], nextCursor: null } });
  } else if (message.method === "thread/turns/list") {
    send({ id: message.id, result: { data: [
      { status: "interrupted", items: [] }
    ] } });
  }
});
`);

    await expect(
      readThreadsFromHost(
        { destination: "winbox", hostId: "windows-host" },
        ["C:\\work"],
        fakeSsh,
      ),
    ).resolves.toEqual([
      {
        cwd: "c:\\WORK\\repo",
        id: "windows-thread",
        recencyAtMs: 11_000,
        remoteHostId: "windows-host",
        remotePlatform: "windows",
        rolloutPath: "C:\\Users\\dev\\.codex\\rollout.jsonl",
        status: "awaiting-response",
        title: "Windows chat",
        updatedAtMs: 12_000,
      },
    ]);
  });

  it("rejects a closed SSH stdin without an unhandled EPIPE", async () => {
    const fakeSsh = await fakeSshScript(`
import { closeSync } from "node:fs";
closeSync(0);
setTimeout(() => undefined, 1_000);
`);

    await expect(
      readThreadsFromHost(
        { destination: "devbox", hostId: "closed-stdin" },
        ["/srv/work"],
        fakeSsh,
      ),
    ).rejects.toThrow(/stdin|write|exited/u);
  });

  it("surfaces JSON-RPC errors from the app server", async () => {
    const fakeSsh = await fakeSshScript(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 0) {
    send({ id: 0, result: { userAgent: "fake" } });
  } else if (message.method === "thread/list") {
    send({
      id: message.id,
      error: { code: -32001, message: "Server overloaded; retry later." }
    });
  }
});
`);

    await expect(
      readThreadsFromHost(
        { destination: "devbox", hostId: "protocol-error" },
        ["/srv/work"],
        fakeSsh,
      ),
    ).rejects.toThrow(
      /request 1 failed.*\(-32001\).*Server overloaded; retry later/u,
    );
  });

  it("rejects malformed app-server result payloads", async () => {
    const fakeSsh = await fakeSshScript(`
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 0) {
    send({ id: 0, result: { userAgent: "fake" } });
  } else if (message.method === "thread/list") {
    send({ id: message.id, result: { data: "not-an-array" } });
  }
});
`);

    await expect(
      readThreadsFromHost(
        { destination: "devbox", hostId: "invalid-result" },
        ["/srv/work"],
        fakeSsh,
      ),
    ).rejects.toThrow(/Invalid thread\/list data/u);
  });

  it("maps active remote states to Stream Deck attention states", () => {
    expect(
      remoteAgentStatus(
        { type: "active", activeFlags: ["waitingOnApproval"] },
        { status: "inProgress" },
      ),
    ).toBe("awaiting-approval");
    expect(
      remoteAgentStatus(
        { type: "active", activeFlags: ["waitingOnUserInput"] },
        { status: "inProgress" },
      ),
    ).toBe("awaiting-response");
    expect(
      remoteAgentStatus({ type: "notLoaded" }, { status: "completed" }),
    ).toBe("unread");
    expect(
      remoteAgentStatus({ type: "notLoaded" }, { status: "interrupted" }),
    ).toBe("error");
  });
});
