export const MAX_AGENT_SLOTS = 20;

export function normalizeAgentSlot(slot: unknown): number {
  return Math.min(MAX_AGENT_SLOTS, Math.max(1, Math.trunc(Number(slot) || 1)));
}
