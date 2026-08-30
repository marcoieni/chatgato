import type { CodexUsageWindow } from "../types.js";

export function remainingPercent(
  window: CodexUsageWindow,
  nowMs?: number,
): number {
  // Once the reported window has reset, its old consumption no longer applies.
  if (
    nowMs !== undefined &&
    window.resetsAtMs !== null &&
    nowMs >= window.resetsAtMs
  ) {
    return 100;
  }

  return Math.round(Math.min(100, Math.max(0, 100 - window.usedPercent)));
}

export function usageWindowLabel(windowMinutes: number): string {
  if (windowMinutes % 10_080 === 0) return `${windowMinutes / 10_080}W`;
  if (windowMinutes % 1_440 === 0) return `${windowMinutes / 1_440}D`;
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}H`;
  return `${Math.round(windowMinutes)}M`;
}
