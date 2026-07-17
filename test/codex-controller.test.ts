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

  it("normalizes supported slash commands", () => {
    expect(normalizeSlashCommand("  /fast  ")).toBe("/fast");
    expect(normalizeSlashCommand("/fork")).toBe("/fork");
  });

  it("rejects slash-command arguments and injected input", () => {
    expect(() => normalizeSlashCommand("/fast on")).toThrow(
      "Invalid Codex slash command",
    );
    expect(() => normalizeSlashCommand("/fast\n/plan")).toThrow(
      "Invalid Codex slash command",
    );
  });

  it("maps push-to-talk state to distinct key-down and key-up events", () => {
    expect(pushToTalkPayload(true)).toBe("dictationDown");
    expect(pushToTalkPayload(false)).toBe("dictationUp");
  });
});
