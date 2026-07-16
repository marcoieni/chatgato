import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionPoller, pollIntervalMs } from "../src/lib/action-poller.js";

describe("ActionPoller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs immediately, repeats, and stops by action id", async () => {
    vi.useFakeTimers();
    const poller = new ActionPoller();
    const task = vi.fn(async () => undefined);

    await poller.start("usage", task, 1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(task).toHaveBeenCalledTimes(3);

    poller.stop("usage");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(3);
  });

  it("does not install a stale timer after polling is restarted", async () => {
    vi.useFakeTimers();
    const poller = new ActionPoller();
    let finishFirstRun!: () => void;
    const firstTask = vi.fn(
      () => new Promise<void>((resolve) => {
        finishFirstRun = resolve;
      }),
    );
    const secondTask = vi.fn(async () => undefined);

    const firstStart = poller.start("agent", firstTask, 1_000);
    await poller.start("agent", secondTask, 1_000);
    finishFirstRun();
    await firstStart;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(firstTask).toHaveBeenCalledOnce();
    expect(secondTask).toHaveBeenCalledTimes(2);
    poller.stop("agent");
  });

  it("waits for an asynchronous poll to settle before scheduling the next one", async () => {
    vi.useFakeTimers();
    const poller = new ActionPoller();
    const finishes: Array<() => void> = [];
    const task = vi.fn(
      () => new Promise<void>((resolve) => {
        finishes.push(resolve);
      }),
    );

    const start = poller.start("agent", task, 1_000);
    finishes[0]!();
    await start;

    vi.advanceTimersByTime(1_000);
    expect(task).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5_000);
    expect(task).toHaveBeenCalledTimes(2);

    finishes[1]!();
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(999);
    expect(task).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(3);
    poller.stop("agent");
  });
});

describe("pollIntervalMs", () => {
  it("applies defaults and bounds in seconds", () => {
    expect(pollIntervalMs(undefined, 15, 5, 300)).toBe(15_000);
    expect(pollIntervalMs(1, 15, 5, 300)).toBe(5_000);
    expect(pollIntervalMs(500, 15, 5, 300)).toBe(300_000);
  });
});
