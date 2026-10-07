import { afterEach, describe, expect, it, vi } from "vitest";
import {
  T3Store,
  t3SourceKey,
  t3SshArguments,
  type T3ThreadSource,
} from "../src/lib/t3-store.js";
import type { CodexThread } from "../src/types.js";

const thread: CodexThread = {
  id: "t3:one",
  title: "T3 task",
  cwd: "/project",
  updatedAtMs: 1,
  status: "working",
  rolloutPath: null,
  reasoningEffort: null,
  spawnStatus: null,
};
const localThread = {
  ...thread,
  id: `t3:${JSON.stringify(["", "", "", thread.id])}`,
};
afterEach(() => vi.useRealTimers());

describe("T3Store", () => {
  it("includes T3 Connect threads alongside SSH and local threads", async () => {
    const read = vi.fn(async (source: T3ThreadSource) => [
      {
        ...thread,
        title: source.environmentId ? "relay" : source.host ? "ssh" : "local",
        updatedAtMs: source.environmentId ? 3 : source.host ? 2 : 1,
      },
    ]);
    const store = new T3Store(read, async () => [
      { host: "devbox" },
      { environmentId: "remote" },
    ]);
    const result = await Promise.all(
      [1, 2, 3].map((slot) =>
        store.threadAtSlot(slot, { cwdFilter: "/project" }),
      ),
    );
    expect(result.map((t) => t!.title)).toEqual(["relay", "ssh", "local"]);
    expect(result[0]!.id).toBe(
      `t3:${JSON.stringify(["relay", "remote", thread.id])}`,
    );
    expect(read).toHaveBeenCalledWith({
      environmentId: "remote",
      cwdFilter: "/project",
    });
  });
  it("preserves the raw thread and environment IDs while namespacing key identity", async () => {
    const t3ThreadRef = {
      threadId: "original-thread",
      environmentId: "remote-environment",
    };
    const store = new T3Store(
      async ({ host }) =>
        host ? [{ ...thread, id: t3ThreadRef.threadId, t3ThreadRef }] : [],
      async () => [{ host: "devbox" }],
    );
    expect(await store.threadAtSlot(1, {})).toMatchObject({
      id: `t3:${JSON.stringify(["devbox", "", "", "original-thread"])}`,
      t3ThreadRef,
    });
  });

  it("ranks threads from all machines together and preserves machine identities", async () => {
    const read = vi.fn(async ({ host }: T3ThreadSource) => [
      { ...thread, updatedAtMs: host === "devbox" ? 3 : host ? 2 : 1 },
    ]);
    const discover = vi.fn(async () => [{ host: "devbox" }, { host: "other" }]);
    const store = new T3Store(read, discover);
    const threads = await Promise.all(
      [1, 2, 3, 4].map((slot) => store.threadAtSlot(slot, {})),
    );
    expect(threads.map((t) => t?.updatedAtMs)).toEqual([3, 2, 1, undefined]);
    expect(new Set(threads.slice(0, 3).map((t) => t!.id)).size).toBe(3);
    expect(read).toHaveBeenCalledTimes(3);
    expect(discover).toHaveBeenCalledOnce();
  });

  it("limits the merged list to 20 threads, with stable ordering for ties", async () => {
    const read = async ({ host }: T3ThreadSource) =>
      Array.from({ length: 20 }, (_, index) => ({
        ...thread,
        id: String(index),
        updatedAtMs: index,
        title: host ?? "local",
      }));
    const store = new T3Store(read, async () => [{ host: "devbox" }]);
    const threads = await Promise.all(
      Array.from({ length: 21 }, (_, i) => store.threadAtSlot(i + 1, {})),
    );
    expect(threads.slice(0, 20).map((t) => t!.updatedAtMs)).toEqual(
      Array.from({ length: 20 }, (_, i) => 19 - Math.floor(i / 2)),
    );
    expect(threads[20]).toBeNull();
    const reversed = new T3Store(read, async () => [
      { host: "b" },
      { host: "a" },
    ]);
    const ordered = new T3Store(read, async () => [
      { host: "a" },
      { host: "b" },
    ]);
    expect(await reversed.threadAtSlot(2, {})).toEqual(
      await ordered.threadAtSlot(2, {}),
    );
  });

  it("applies the workspace filter everywhere and the home override only locally", async () => {
    const read = vi.fn(async () => [thread]);
    const store = new T3Store(read, async () => [{ host: "devbox" }]);
    const settings = {
      t3Home: " /custom ",
      cwdFilter: " /project ",
      t3SshHost: "old",
    };
    await store.threadAtSlot(1, settings);
    expect(read.mock.calls).toEqual([
      [{ home: "/custom", cwdFilter: "/project" }],
      [{ host: "devbox", cwdFilter: "/project" }],
    ]);
    expect(t3SourceKey(settings)).toBe(
      t3SourceKey({ t3Home: "/custom", cwdFilter: "/project" }),
    );
    const filtered = await store.threadAtSlot(1, { cwdFilter: "/project" });
    const unfiltered = await store.threadAtSlot(1, {});
    expect(filtered!.id).toBe(unfiltered!.id);
  });

  it.each([undefined, "offline"])(
    "keeps healthy machines when %s cannot be read",
    async (failedHost) => {
      const read = async ({ host }: T3ThreadSource) => {
        if (host === failedHost) throw new Error("offline");
        return [thread];
      };
      const store = new T3Store(read, async () => [{ host: "offline" }]);
      expect(await store.threadAtSlot(1, {})).toMatchObject({
        title: thread.title,
      });
      expect(await store.threadAtSlot(2, {})).toBeNull();
    },
  );

  it("reports discovery failures instead of hiding unreadable saved connections", async () => {
    const store = new T3Store(
      async () => [thread],
      async () => {
        throw new Error("invalid config");
      },
    );
    await expect(store.threadAtSlot(1, {})).rejects.toThrow("invalid config");
  });

  it("reports all-machine failures but accepts an empty healthy machine", async () => {
    const read = vi
      .fn<(source: T3ThreadSource) => Promise<CodexThread[]>>()
      .mockRejectedValue(new Error("offline"));
    const store = new T3Store(read, async () => [{ host: "devbox" }]);
    await expect(store.threadAtSlot(1, {})).rejects.toThrow("any machine");
    read.mockResolvedValueOnce([]);
    expect(
      await new T3Store(read, async () => [{ host: "devbox" }]).threadAtSlot(
        1,
        {},
      ),
    ).toBeNull();
  });

  it("shares in-flight reads across slots, then refreshes completed reads", async () => {
    vi.useFakeTimers();
    let finish!: (threads: CodexThread[]) => void;
    const read = vi.fn(
      () =>
        new Promise<CodexThread[]>((resolve) => {
          finish = resolve;
        }),
    );
    const store = new T3Store(read, async () => []);
    const first = store.threadAtSlot(1, {});
    const second = store.threadAtSlot(2, {});
    vi.advanceTimersByTime(2_000);
    const third = store.threadAtSlot(1, {});
    await Promise.resolve();
    expect(read).toHaveBeenCalledOnce();
    finish([thread]);
    expect(await Promise.all([first, second, third])).toEqual([
      localThread,
      null,
      localThread,
    ]);
    await store.threadAtSlot(1, {});
    expect(read).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    read.mockResolvedValue([]);
    expect(await store.threadAtSlot(1, {})).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("shares legacy host settings while keeping custom-home and workspace reads separate", async () => {
    const read = vi.fn(async () => [thread]);
    const store = new T3Store(read, async () => []);
    for (const settings of [
      {},
      { t3SshHost: "devbox", source: "t3-code" as const },
      { t3Home: "/custom" },
      { cwdFilter: "/project" },
    ]) {
      await store.threadAtSlot(1, settings);
    }
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("retries failures without retaining stale status", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => [thread]);
    const store = new T3Store(read, async () => []);
    await store.threadAtSlot(1, {});
    vi.advanceTimersByTime(1_000);
    read.mockRejectedValue(new Error("offline"));
    await expect(store.threadAtSlot(1, {})).rejects.toThrow("any machine");
    vi.advanceTimersByTime(1_000);
    read.mockResolvedValue([thread]);
    expect(await store.threadAtSlot(1, {})).toEqual(localThread);
  });

  it("uses noninteractive SSH and keeps paths out of the remote shell", () => {
    const options = Buffer.from(
      JSON.stringify({ home: "/tmp/a ' $(touch nope)" }),
    ).toString("base64");
    const args = t3SshArguments("marco@devbox", options, 2222);
    expect(args.slice(-4, -1)).toEqual(["-p", "2222", "marco@devbox"]);
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args.at(-1)).toBe(`node --input-type=module - ${options}`);
    expect(args.join(" ")).not.toContain("touch");
  });

  it.each([0, -1, 65536, 1.5, NaN])(
    "rejects invalid saved SSH ports: %s",
    (port) => {
      expect(() => t3SshArguments("devbox", "e30=", port)).toThrow("SSH port");
    },
  );

  it.each([
    "-oProxyCommand=bad",
    "host;bad",
    "host\nbad",
    "host bad",
    "$(bad)",
  ])("rejects invalid SSH destinations: %s", (host) => {
    expect(() => t3SshArguments(host, "e30=")).toThrow("SSH host");
  });
});
