import { describe, expect, it, vi } from "vitest";
import { CodexUsageService } from "../src/lib/codex-usage-service.js";
import { remainingPercent } from "../src/lib/codex-usage.js";
import type { CodexUsageSnapshot } from "../src/types.js";

function snapshot(
  updatedAtMs: number,
  usedPercent: number,
): CodexUsageSnapshot {
  return {
    updatedAtMs,
    primary: { usedPercent, windowMinutes: 300, resetsAtMs: null },
    secondary: null,
    planType: "pro",
    credits: null,
  };
}

describe("CodexUsageService", () => {
  it("uses live data without reading the rollout fallback", async () => {
    const live = snapshot(200, 10);
    const readFallback = vi.fn(async () => snapshot(100, 80));
    const service = new CodexUsageService(async () => live, readFallback);

    await expect(service.latestUsage()).resolves.toBe(live);
    expect(readFallback).not.toHaveBeenCalled();
  });

  it("uses rollout data when the initial live read fails", async () => {
    const fallback = snapshot(100, 20);
    const service = new CodexUsageService(
      async () => {
        throw new Error("app-server unavailable");
      },
      async () => fallback,
    );

    await expect(service.latestUsage()).resolves.toBe(fallback);
  });

  it("does not overwrite a successful live value with an older fallback", async () => {
    const readLive = vi
      .fn<() => Promise<CodexUsageSnapshot | null>>()
      .mockResolvedValueOnce(snapshot(200, 10))
      .mockRejectedValueOnce(new Error("temporary failure"));
    const service = new CodexUsageService(readLive, async () =>
      snapshot(100, 90),
    );

    await expect(service.latestUsage()).resolves.toMatchObject({
      updatedAtMs: 200,
      primary: { usedPercent: 10 },
    });
    await expect(service.latestUsage()).rejects.toThrow(/fallback is stale/u);
  });

  it("allows a newer rollout event to act as fallback", async () => {
    const readLive = vi
      .fn<() => Promise<CodexUsageSnapshot | null>>()
      .mockResolvedValueOnce(snapshot(200, 10))
      .mockRejectedValueOnce(new Error("temporary failure"));
    const service = new CodexUsageService(readLive, async () =>
      snapshot(300, 15),
    );

    await service.latestUsage();
    await expect(service.latestUsage()).resolves.toMatchObject({
      updatedAtMs: 300,
      primary: { usedPercent: 15 },
    });
  });

  it("uses a fresh live meter after an early reset", async () => {
    const readLive = vi
      .fn<() => Promise<CodexUsageSnapshot | null>>()
      .mockResolvedValueOnce(snapshot(100, 80))
      .mockResolvedValueOnce(snapshot(200, 0));
    const service = new CodexUsageService(readLive, async () =>
      snapshot(150, 80),
    );

    expect(remainingPercent((await service.latestUsage()).primary!)).toBe(20);
    expect(remainingPercent((await service.latestUsage()).primary!)).toBe(100);
  });
});
