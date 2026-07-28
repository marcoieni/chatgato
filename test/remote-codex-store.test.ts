import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readRemoteThreadRows,
  readThreadsFromHost,
  remoteAgentStatus,
} from "../src/lib/remote-codex-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("remote Codex task discovery", () => {
  it("reads each configured SSH project's tasks", async () => {
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
        rolloutPath: "/remote/rollout.jsonl",
        status: "unread" as const,
        title: paths[0]!,
        updatedAtMs: 2_100,
      },
    ]);

    await expect(readRemoteThreadRows(home, readHost)).resolves.toEqual([
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
      ["/srv/work"],
    );
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
          rolloutPath: "/rollout-b",
          status: "idle" as const,
          title: "B",
          updatedAtMs: 1,
        },
      ];
    });

    await expect(readRemoteThreadRows(home, readHost)).resolves.toEqual([
      expect.objectContaining({ id: "thread-b" }),
    ]);
  });

  it("speaks the app-server protocol over SSH and reads latest turn status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chatgato-fake-ssh-"));
    temporaryDirectories.push(directory);
    const fakeSsh = join(directory, "fake-ssh.mjs");
    await writeFile(
      fakeSsh,
      `#!/usr/bin/env node
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 0) {
    send({ id: 0, result: { userAgent: "fake" } });
  } else if (message.method === "thread/list") {
    send({ id: message.id, result: { data: [
      {
        id: "remote-thread",
        name: "Remote task",
        preview: "Fallback title",
        cwd: "/srv/work/project",
        path: "/home/user/.codex/rollout.jsonl",
        updatedAt: 12,
        recencyAt: 11,
        status: { type: "notLoaded" }
      },
      {
        id: "outside-thread",
        name: "Outside",
        cwd: "/srv/elsewhere",
        path: "/outside.jsonl",
        updatedAt: 13,
        recencyAt: 13,
        status: { type: "notLoaded" }
      }
    ] } });
  } else if (message.method === "thread/turns/list") {
    send({ id: message.id, result: { data: [
      { status: "completed", items: [] }
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
        rolloutPath: "/home/user/.codex/rollout.jsonl",
        status: "unread",
        title: "Remote task",
        updatedAtMs: 12_000,
      },
    ]);
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
