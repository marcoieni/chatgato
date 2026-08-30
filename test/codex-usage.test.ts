import { describe, expect, it } from "vitest";
import { remainingPercent, usageWindowLabel } from "../src/lib/codex-usage.js";

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
});
