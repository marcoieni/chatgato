import { describe, expect, it } from "vitest";
import {
  buildNewTaskUrl,
  buildRunPrompt,
  buildRunPromptUrl,
  buildThreadUrl,
} from "../src/lib/deep-links.js";

describe("Codex deep links", () => {
  it("uses the canonical empty-task link", () => {
    expect(buildNewTaskUrl({})).toBe("codex://threads/new");
  });

  it("encodes workspace and prompt parameters", () => {
    const url = buildNewTaskUrl({ path: "/tmp/my project", prompt: "Review a & b" });
    expect(url).toContain("prompt=Review+a+%26+b");
    expect(url).toContain("path=%2Ftmp%2Fmy+project");
  });

  it("runs the custom prompt exactly as entered", () => {
    const settings = { prompt: "  $debugger Investigate the flaky test  ", path: "/tmp/repo" };
    expect(buildRunPrompt(settings)).toBe("$debugger Investigate the flaky test");
    expect(buildRunPromptUrl(settings)).toContain(
      "prompt=%24debugger+Investigate+the+flaky+test",
    );
  });

  it("keeps explicitly configured legacy workflow keys working", () => {
    const settings = { workflow: "debug", skillName: "$debugger" };
    expect(buildRunPrompt(settings)).toMatch(/^\$debugger Debug the current error/);
  });

  it("does not restore a legacy workflow after a prompt is cleared", () => {
    expect(buildRunPrompt({ prompt: "", workflow: "debug" })).toBe("");
  });

  it("rejects unsafe thread ids", () => {
    expect(buildThreadUrl("019f6995-c7a3-7601-9e00-1fda9de50d42")).toBe(
      "codex://threads/019f6995-c7a3-7601-9e00-1fda9de50d42",
    );
    expect(() => buildThreadUrl("../../bad")).toThrow("Invalid Codex thread id");
  });
});
