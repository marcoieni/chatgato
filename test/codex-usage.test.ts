import { describe, expect, it } from "vitest";
import {
  compactDuration,
  compactTokenCount,
  remainingPercent,
  resetCountdownLabel,
  usageWindowLabel,
} from "../src/lib/codex-usage.js";

describe("Codex usage", () => {
  it("labels common limit windows compactly", () => {
    expect(usageWindowLabel(300)).toBe("5H");
    expect(usageWindowLabel(1_440)).toBe("1D");
    expect(usageWindowLabel(10_080)).toBe("1W");
  });

  it("restores remaining usage when a stale snapshot's window has reset", () => {
    const window = {
      usedPercent: 4,
      windowMinutes: 10_080,
      resetsAtMs: Date.parse("2026-08-11T08:00:00.000Z"),
    };

    expect(
      remainingPercent(window, Date.parse("2026-08-11T07:59:59.999Z")),
    ).toBe(96);
    expect(
      remainingPercent(window, Date.parse("2026-08-11T08:00:00.000Z")),
    ).toBe(100);
  });

  it("does not infer a reset when Codex omits the reset time", () => {
    expect(
      remainingPercent(
        { usedPercent: 4, windowMinutes: 10_080, resetsAtMs: null },
        Date.now(),
      ),
    ).toBe(96);
  });

  it("formats reset countdowns for the space available on a key", () => {
    const now = Date.parse("2026-08-30T10:00:00.000Z");
    expect(resetCountdownLabel(now + 3 * 86_400_000 + 2 * 3_600_000, now)).toBe(
      "RESET 3D 2H",
    );
    expect(resetCountdownLabel(now + 2 * 3_600_000 + 14 * 60_000, now)).toBe(
      "RESET 2H 14M",
    );
    expect(resetCountdownLabel(now + 30_000, now)).toBe("RESET <1M");
    expect(resetCountdownLabel(now, now)).toBe("RESET NOW");
    expect(resetCountdownLabel(null, now)).toBeNull();
  });

  it("compacts token totals and turn durations", () => {
    expect(compactTokenCount(12_400_000)).toBe("12.4M");
    expect(compactTokenCount(482_000)).toBe("482K");
    expect(compactTokenCount(null)).toBe("—");
    expect(compactDuration(3_900)).toBe("1H 5M");
    expect(compactDuration(null)).toBe("—");
  });
});
