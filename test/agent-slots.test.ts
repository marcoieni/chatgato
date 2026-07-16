import { describe, expect, it } from "vitest";
import { MAX_AGENT_SLOTS, normalizeAgentSlot } from "../src/lib/agent-slots.js";

describe("Agent Status slots", () => {
  it("supports 20 agent keys", () => {
    expect(MAX_AGENT_SLOTS).toBe(20);
    expect(normalizeAgentSlot(20)).toBe(20);
  });

  it("clamps invalid slots to the available range", () => {
    expect(normalizeAgentSlot(21)).toBe(20);
    expect(normalizeAgentSlot(0)).toBe(1);
    expect(normalizeAgentSlot(undefined)).toBe(1);
  });
});
