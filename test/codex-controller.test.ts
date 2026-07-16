import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  normalizePaletteQuery,
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

  it("normalizes ordinary and localized Command Menu queries", () => {
    expect(normalizePaletteQuery("  Review (PR) + docs  ", "win32")).toBe(
      "Review (PR) + docs",
    );
    expect(normalizePaletteQuery("Réviser la tâche", "win32")).toBe("Réviser la tâche");
  });

  it("rejects Windows SendKeys named-key injection", () => {
    expect(() => normalizePaletteQuery("Approve{ENTER}", "win32")).toThrow(
      "unsupported SendKeys characters",
    );
    expect(() => normalizePaletteQuery("{TAB}Decline", "win32")).toThrow(
      "unsupported SendKeys characters",
    );
  });

  it("rejects control characters on every platform", () => {
    expect(() => normalizePaletteQuery("Approve\nDecline", "win32")).toThrow(
      "control characters",
    );
    expect(() => normalizePaletteQuery("Approve\tDecline", "darwin")).toThrow(
      "control characters",
    );
  });

  it("does not unnecessarily reject braces on macOS", () => {
    expect(normalizePaletteQuery("Open {preview}", "darwin")).toBe("Open {preview}");
  });

  it("normalizes supported slash commands", () => {
    expect(normalizeSlashCommand("  /fast  ")).toBe("/fast");
    expect(normalizeSlashCommand("/fork")).toBe("/fork");
  });

  it("rejects slash-command arguments and injected input", () => {
    expect(() => normalizeSlashCommand("/fast on")).toThrow("Invalid Codex slash command");
    expect(() => normalizeSlashCommand("/fast\n/plan")).toThrow("Invalid Codex slash command");
  });

  it("maps push-to-talk state to distinct key-down and key-up events", () => {
    expect(pushToTalkPayload(true)).toBe("dictationDown");
    expect(pushToTalkPayload(false)).toBe("dictationUp");
  });

  it("routes reasoning changes through the dedicated reasoning picker", () => {
    expect(COMMANDS.reasoningUp).toEqual({ kind: "reasoning", value: "increase" });
    expect(COMMANDS.reasoningDown).toEqual({ kind: "reasoning", value: "decrease" });
  });
});
