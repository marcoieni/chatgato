import { describe, expect, it } from "vitest";
import {
  COMMANDS,
  hasThreadSearchShortcut,
  normalizeSlashCommand,
  normalizeThreadSearchQuery,
  pushToTalkPayload,
  resolveCodexKeybinding,
  validateThreadSearchResultIndex,
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

  it("normalizes task titles before using the chat search", () => {
    expect(normalizeThreadSearchQuery("  Fix   remote\nbuttons  ")).toBe(
      "Fix remote buttons",
    );
    expect(() => normalizeThreadSearchQuery(" \n ")).toThrow(
      "Thread title is required",
    );
    expect(normalizeThreadSearchQuery(`${"x".repeat(200)}suffix`)).toHaveLength(
      200,
    );
  });

  it("supports every advertised task search result", () => {
    expect(validateThreadSearchResultIndex(0)).toBe(0);
    expect(validateThreadSearchResultIndex(19)).toBe(19);
    expect(() => validateThreadSearchResultIndex(20)).toThrow(
      "result indexes 0 through 19",
    );
    expect(() => validateThreadSearchResultIndex(-1)).toThrow(
      "result indexes 0 through 19",
    );
  });

  it("resolves custom app-scoped keybindings for the current platform", () => {
    expect(
      resolveCodexKeybinding(
        [{ command: "composer.toggleFastMode", key: "Command+K" }],
        "composer.toggleFastMode",
        "darwin",
      ),
    ).toBe("command+k");
    expect(
      resolveCodexKeybinding(
        [{ command: "searchChats", key: "CmdOrCtrl+Option+Shift+S" }],
        "searchChats",
        "darwin",
      ),
    ).toBe("command+alt+shift+s");
    expect(
      resolveCodexKeybinding(
        [{ command: "composer.togglePlanMode", key: "CmdOrCtrl+F12" }],
        "composer.togglePlanMode",
        "win32",
      ),
    ).toBe("control+f12");
  });

  it("recognizes any supported Switch chat binding", () => {
    expect(
      hasThreadSearchShortcut(
        [{ command: "searchChats", key: "Control+K" }],
        "darwin",
      ),
    ).toBe(true);
    expect(
      hasThreadSearchShortcut(
        [{ command: "searchChats", key: "Ctrl+Alt+Shift+S" }],
        "win32",
      ),
    ).toBe(true);
    expect(
      hasThreadSearchShortcut(
        [{ command: "openCommandMenu", key: "Command+K" }],
        "darwin",
      ),
    ).toBe(false);
    expect(
      hasThreadSearchShortcut(
        [{ command: "searchChats", key: "Command+K" }],
        "win32",
      ),
    ).toBe(false);
  });

  it("honors the last command entry and rejects unsupported bindings", () => {
    expect(
      resolveCodexKeybinding(
        [
          { command: "searchChats", key: "Command+K" },
          { command: "searchChats", key: null },
        ],
        "searchChats",
        "darwin",
      ),
    ).toBeNull();
    expect(
      resolveCodexKeybinding(
        [{ command: "searchChats", key: "Command+K+S" }],
        "searchChats",
        "darwin",
      ),
    ).toBeNull();
    expect(
      resolveCodexKeybinding(
        [{ command: "searchChats", key: "Command+F21" }],
        "searchChats",
        "darwin",
      ),
    ).toBeNull();
    expect(
      resolveCodexKeybinding(
        [{ command: "searchChats", key: "Command+Unsupported+K" }],
        "searchChats",
        "darwin",
      ),
    ).toBeNull();
  });

  it("maps push-to-talk state to distinct key-down and key-up events", () => {
    expect(pushToTalkPayload(true)).toBe("dictationDown");
    expect(pushToTalkPayload(false)).toBe("dictationUp");
  });
});
