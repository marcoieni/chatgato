import { describe, expect, it } from "vitest";
import type { ReasoningSnapshot } from "../src/lib/codex-store.js";
import { ReasoningTracker } from "../src/lib/reasoning-tracker.js";

const efforts = ["low", "medium", "high", "xhigh", "max", "ultra"];

function snapshot(currentEffort: string): ReasoningSnapshot {
  return {
    currentEffort,
    efforts,
    model: "gpt-test",
    threadId: "thread-1",
  };
}

describe("ReasoningTracker", () => {
  it("steps through every level while Codex still reports a stale effort", () => {
    const tracker = new ReasoningTracker();
    const stale = snapshot("xhigh");

    const toMax = tracker.plan(stale, "increase");
    expect(toMax.effort).toBe("max");
    tracker.commit(toMax);

    const toExtraHigh = tracker.plan(stale, "decrease");
    expect(toExtraHigh.effort).toBe("xhigh");
    tracker.commit(toExtraHigh);

    const toHigh = tracker.plan(stale, "decrease");
    expect(toHigh.effort).toBe("high");
    tracker.commit(toHigh);

    const backToExtraHigh = tracker.plan(stale, "increase");
    expect(backToExtraHigh.effort).toBe("xhigh");
  });

  it("keeps tracked state when Codex catches up to an intermediate selection", () => {
    const tracker = new ReasoningTracker();
    const toExtraHigh = tracker.plan(snapshot("high"), "increase");
    tracker.commit(toExtraHigh);
    const toMax = tracker.plan(snapshot("high"), "increase");
    tracker.commit(toMax);

    expect(tracker.plan(snapshot("xhigh"), "decrease").effort).toBe("xhigh");
  });

  it("resets when Codex reports an effort not seen in the tracked sequence", () => {
    const tracker = new ReasoningTracker();
    const toMax = tracker.plan(snapshot("xhigh"), "increase");
    tracker.commit(toMax);

    expect(tracker.plan(snapshot("medium"), "increase").effort).toBe("high");
  });
});
