import {
  reasoningTargetIndex,
  type ReasoningDirection,
  type ReasoningSnapshot,
  type ReasoningTarget,
} from "./codex-store.js";

type TrackedReasoning = {
  currentEffort: string;
  effortsKey: string;
  model: string;
  seenEfforts: Set<string>;
};

export type ReasoningPlan = ReasoningTarget & {
  snapshot: ReasoningSnapshot;
};

export class ReasoningTracker {
  private readonly tracked = new Map<string, TrackedReasoning>();

  plan(
    snapshot: ReasoningSnapshot,
    direction: ReasoningDirection,
    steps = 1,
  ): ReasoningPlan {
    const effortsKey = snapshot.efforts.join("\0");
    const previous = this.tracked.get(snapshot.threadId);
    // Codex can keep reporting any recently selected effort while its composer state is ahead.
    // Trust our last successful selection until Codex reports a value outside that sequence.
    const canUseTracked =
      previous?.model === snapshot.model &&
      previous.effortsKey === effortsKey &&
      previous.seenEfforts.has(snapshot.currentEffort);
    const currentEffort = canUseTracked
      ? previous.currentEffort
      : snapshot.currentEffort;
    const currentIndex = snapshot.efforts.indexOf(currentEffort);
    const optionIndex = reasoningTargetIndex(
      snapshot.efforts,
      currentEffort,
      direction,
      steps,
    );

    return {
      changed: optionIndex !== currentIndex,
      effort: snapshot.efforts[optionIndex]!,
      optionIndex,
      snapshot,
    };
  }

  commit(plan: ReasoningPlan): void {
    const { snapshot } = plan;
    const effortsKey = snapshot.efforts.join("\0");
    const previous = this.tracked.get(snapshot.threadId);
    const seenEfforts =
      previous?.model === snapshot.model && previous.effortsKey === effortsKey
        ? previous.seenEfforts
        : new Set<string>();
    seenEfforts.add(snapshot.currentEffort);
    seenEfforts.add(plan.effort);
    this.tracked.set(snapshot.threadId, {
      currentEffort: plan.effort,
      effortsKey,
      model: snapshot.model,
      seenEfforts,
    });
  }
}
