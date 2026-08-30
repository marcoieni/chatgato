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

export function resetCountdownLabel(
  resetsAtMs: number | null,
  nowMs = Date.now(),
): string | null {
  if (resetsAtMs === null) return null;
  const seconds = Math.max(0, Math.ceil((resetsAtMs - nowMs) / 1_000));
  if (seconds === 0) return "RESET NOW";

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `RESET ${days}D${hours > 0 ? ` ${hours}H` : ""}`;
  if (hours > 0) {
    return `RESET ${hours}H${minutes > 0 ? ` ${minutes}M` : ""}`;
  }
  if (minutes > 0) return `RESET ${minutes}M`;
  return "RESET <1M";
}

export function compactTokenCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const absolute = Math.max(0, value);
  if (absolute < 1_000) return Math.round(absolute).toString();
  if (absolute < 1_000_000) return compactUnit(absolute / 1_000, "K");
  if (absolute < 1_000_000_000) return compactUnit(absolute / 1_000_000, "M");
  return compactUnit(absolute / 1_000_000_000, "B");
}

export function compactDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const wholeSeconds = Math.max(0, Math.round(seconds));
  const days = Math.floor(wholeSeconds / 86_400);
  const hours = Math.floor((wholeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  if (days > 0) return `${days}D${hours > 0 ? ` ${hours}H` : ""}`;
  if (hours > 0) return `${hours}H${minutes > 0 ? ` ${minutes}M` : ""}`;
  if (minutes > 0) return `${minutes}M`;
  return `${wholeSeconds}S`;
}

function compactUnit(value: number, suffix: string): string {
  const digits = value < 100 ? 1 : 0;
  return `${value.toFixed(digits).replace(/\.0$/u, "")}${suffix}`;
}
