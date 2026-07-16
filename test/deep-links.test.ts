import { describe, expect, it } from "vitest";
import {
  buildNewTaskUrl,
  buildThreadUrl,
  buildWorkflowPrompt,
  buildWorkflowUrl,
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

  it("prefixes an installed skill mention", () => {
    const settings = { workflow: "debug", skillName: "$debugger", path: "/tmp/repo" };
    expect(buildWorkflowPrompt(settings)).toMatch(/^\$debugger Debug the current error/);
    expect(buildWorkflowUrl(settings)).toContain("%24debugger+Debug");
  });

  it("rejects unsafe thread ids", () => {
    expect(buildThreadUrl("019f6995-c7a3-7601-9e00-1fda9de50d42")).toBe(
      "codex://threads/019f6995-c7a3-7601-9e00-1fda9de50d42",
    );
    expect(() => buildThreadUrl("../../bad")).toThrow("Invalid Codex thread id");
  });
});
