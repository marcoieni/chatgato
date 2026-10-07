import { afterEach, describe, expect, it, vi } from "vitest";
import { T3Store, t3SshArguments } from "../src/lib/t3-store.js";
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
afterEach(() => vi.useRealTimers());

describe("T3Store", () => {
  it("shares in-flight reads across slots, then refreshes completed reads", async () => {
    vi.useFakeTimers();
    let finish!: (threads: CodexThread[]) => void;
    const read = vi.fn(
      () =>
        new Promise<CodexThread[]>((resolve) => {
          finish = resolve;
        }),
    );
    const store = new T3Store(read);
    const first = store.threadAtSlot(1, {});
    const second = store.threadAtSlot(2, {});
    vi.advanceTimersByTime(2_000);
    const third = store.threadAtSlot(1, {});
    expect(read).toHaveBeenCalledOnce();
    finish([thread]);
    expect(await Promise.all([first, second, third])).toEqual([
      thread,
      null,
      thread,
    ]);
    await store.threadAtSlot(1, {});
    expect(read).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1_000);
    read.mockResolvedValue([]);
    expect(await store.threadAtSlot(1, {})).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("keeps local, remote, custom-home and workspace reads separate", async () => {
    const read = vi.fn(async () => [thread]);
    const store = new T3Store(read);
    for (const settings of [
      {},
      { t3SshHost: "devbox" },
      { t3Home: "/custom" },
      { cwdFilter: "/project" },
    ]) {
      await store.threadAtSlot(1, settings);
    }
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("retries failures without retaining stale status", async () => {
    vi.useFakeTimers();
    const read = vi.fn(async () => [thread]);
    const store = new T3Store(read);
    await store.threadAtSlot(1, {});
    vi.advanceTimersByTime(1_000);
    read.mockRejectedValue(new Error("offline"));
    await expect(store.threadAtSlot(1, {})).rejects.toThrow("offline");
    vi.advanceTimersByTime(1_000);
    read.mockResolvedValue([thread]);
    expect(await store.threadAtSlot(1, {})).toEqual(thread);
  });

  it("uses noninteractive SSH and keeps paths out of the remote shell", () => {
    const options = Buffer.from(
      JSON.stringify({ home: "/tmp/a ' $(touch nope)" }),
    ).toString("base64");
    const args = t3SshArguments("marco@devbox", options);
    expect(args).toContain("BatchMode=yes");
    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(args.at(-1)).toBe(`node --input-type=module - ${options}`);
    expect(args.join(" ")).not.toContain("touch");
  });

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
