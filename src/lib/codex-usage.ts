import type {
  CodexUsageSnapshot,
  CodexUsageWindow,
  RawRateLimitWindow,
  RolloutRecord,
} from "../types.js";

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseWindow(window: RawRateLimitWindow | null | undefined): CodexUsageWindow | null {
  if (!window) return null;
  const usedPercent = finiteNumber(window.used_percent);
  const windowMinutes = finiteNumber(window.window_minutes);
  if (usedPercent === null || windowMinutes === null || windowMinutes <= 0) return null;

  const resetsAtSeconds = finiteNumber(window.resets_at);
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    windowMinutes,
    resetsAtMs: resetsAtSeconds === null ? null : resetsAtSeconds * 1000,
  };
}

export function usageFromRollout(records: readonly RolloutRecord[]): CodexUsageSnapshot | null {
  let latest: CodexUsageSnapshot | null = null;

  for (const record of records) {
    const limits = record.payload?.rate_limits;
    if (!limits) continue;

    const primary = parseWindow(limits.primary);
    const secondary = parseWindow(limits.secondary);
    const credits = limits.credits
      ? {
          hasCredits: limits.credits.has_credits === true,
          unlimited: limits.credits.unlimited === true,
          balance:
            limits.credits.balance === undefined || limits.credits.balance === null
              ? null
              : String(limits.credits.balance),
        }
      : null;

    if (!primary && !secondary && !credits?.unlimited && !credits?.hasCredits) continue;

    const timestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : NaN;
    latest = {
      updatedAtMs: Number.isFinite(timestamp) ? timestamp : 0,
      primary,
      secondary,
      planType: typeof limits.plan_type === "string" ? limits.plan_type : null,
      credits,
    };
  }

  return latest;
}

export function remainingPercent(window: CodexUsageWindow): number {
  return Math.round(Math.min(100, Math.max(0, 100 - window.usedPercent)));
}

export function usageWindowLabel(windowMinutes: number): string {
  if (windowMinutes % 10_080 === 0) return `${windowMinutes / 10_080}W`;
  if (windowMinutes % 1_440 === 0) return `${windowMinutes / 1_440}D`;
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}H`;
  return `${Math.round(windowMinutes)}M`;
}
