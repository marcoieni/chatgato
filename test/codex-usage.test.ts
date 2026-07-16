import { describe, expect, it } from "vitest";
import {
  remainingPercent,
  usageFromRollout,
  usageWindowLabel,
} from "../src/lib/codex-usage.js";

describe("Codex usage", () => {
  it("reads the latest rate-limit snapshot", () => {
    const usage = usageFromRollout([
      {
        timestamp: "2026-07-16T08:00:00.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          rate_limits: {
            primary: { used_percent: 18.4, window_minutes: 300, resets_at: 1_784_000_000 },
            secondary: { used_percent: 61, window_minutes: 10_080, resets_at: 1_784_500_000 },
            plan_type: "pro",
          },
        },
      },
    ]);

    expect(usage).toMatchObject({
      updatedAtMs: Date.parse("2026-07-16T08:00:00.000Z"),
      planType: "pro",
      primary: { usedPercent: 18.4, windowMinutes: 300 },
      secondary: { usedPercent: 61, windowMinutes: 10_080 },
    });
    expect(remainingPercent(usage!.primary!)).toBe(82);
    expect(remainingPercent(usage!.secondary!)).toBe(39);
  });

  it("labels common limit windows compactly", () => {
    expect(usageWindowLabel(300)).toBe("5H");
    expect(usageWindowLabel(1_440)).toBe("1D");
    expect(usageWindowLabel(10_080)).toBe("1W");
  });

  it("ignores records without account usage", () => {
    expect(usageFromRollout([{ payload: { type: "token_count" } }])).toBeNull();
  });
});
