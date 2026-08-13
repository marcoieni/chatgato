import type { CodexUsageSnapshot } from "../types.js";

export type CodexUsageReader = () => Promise<CodexUsageSnapshot | null>;

/**
 * Prefers live app-server limits while retaining rollout data as a startup
 * compatibility fallback. Once a live value has been shown, an older rollout
 * snapshot is rejected so a transient protocol failure cannot move the key
 * backwards to stale usage.
 */
export class CodexUsageService {
  private lastLiveUpdatedAtMs: number | null = null;

  constructor(
    private readonly readLiveUsage: CodexUsageReader,
    private readonly readFallbackUsage: CodexUsageReader,
  ) {}

  async latestUsage(): Promise<CodexUsageSnapshot> {
    let liveError: unknown;
    try {
      const live = await this.readLiveUsage();
      if (!live) throw new Error("Codex app-server returned no usage data");
      this.lastLiveUpdatedAtMs = live.updatedAtMs;
      return live;
    } catch (error) {
      liveError = error;
    }

    let fallback: CodexUsageSnapshot | null;
    try {
      fallback = await this.readFallbackUsage();
    } catch (fallbackError) {
      throw new AggregateError(
        [liveError, fallbackError],
        "Live and rollout Codex usage reads failed",
        { cause: fallbackError },
      );
    }

    if (!fallback) throw asError(liveError);
    if (
      this.lastLiveUpdatedAtMs !== null &&
      fallback.updatedAtMs <= this.lastLiveUpdatedAtMs
    ) {
      throw new Error(
        "Live Codex usage is unavailable and the rollout fallback is stale",
        { cause: liveError },
      );
    }
    return fallback;
  }
}

function asError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Live Codex usage read failed", { cause: error });
}
