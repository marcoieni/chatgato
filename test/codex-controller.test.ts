import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  normalizeSlashCommand,
  pushToTalkPayload,
} from "../src/lib/codex-controller.js";

describe("Codex controller", () => {
  it("routes approval actions through their context-sensitive shortcuts", () => {
    expect(COMMANDS.approve).toEqual({ kind: "shortcut", value: "approve" });
    expect(COMMANDS.decline).toEqual({ kind: "shortcut", value: "decline" });
  });

  it("keeps the review tab and code review commands distinct", () => {
    expect(COMMANDS.review).toEqual({ kind: "shortcut", value: "review" });
    expect(COMMANDS.openReview).toEqual({ kind: "slash", value: "/review" });
  });

  it("routes Fast and Plan through app-scoped keyboard shortcuts", () => {
    expect(COMMANDS.toggleFast).toEqual({
      kind: "shortcut",
      value: "toggleFastMode",
    });
    expect(COMMANDS.togglePlan).toEqual({
      kind: "shortcut",
      value: "togglePlanMode",
    });
  });

  it("normalizes supported slash commands", () => {
    expect(normalizeSlashCommand("  /review  ")).toBe("/review");
    expect(normalizeSlashCommand("/fork")).toBe("/fork");
  });

  it("rejects slash-command arguments and injected input", () => {
    expect(() => normalizeSlashCommand("/review now")).toThrow(
      "Invalid Codex slash command",
    );
    expect(() => normalizeSlashCommand("/fork\n/review")).toThrow(
      "Invalid Codex slash command",
    );
  });

  it("maps push-to-talk state to distinct key-down and key-up events", () => {
    expect(pushToTalkPayload(true)).toBe("dictationDown");
    expect(pushToTalkPayload(false)).toBe("dictationUp");
  });
});
