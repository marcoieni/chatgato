import { describe, expect, it } from "vitest";
import { buildNewTaskUrl, buildThreadUrl } from "../src/lib/deep-links.js";

describe("Codex deep links", () => {
  it("uses the canonical empty-task link", () => {
    expect(buildNewTaskUrl({})).toBe("codex://threads/new");
  });

  it("encodes workspace and prompt parameters", () => {
    const url = buildNewTaskUrl({
      path: "/tmp/my project",
      prompt: "Review a & b",
    });
    expect(url).toContain("prompt=Review+a+%26+b");
    expect(url).toContain("path=%2Ftmp%2Fmy+project");
  });

  it("encodes an explicit skill mention in a custom prompt", () => {
    const url = buildNewTaskUrl({
      prompt: "  $debugger Investigate the flaky test  ",
      path: "/tmp/repo",
    });
    expect(url).toContain("prompt=%24debugger+Investigate+the+flaky+test");
    expect(url).toContain("path=%2Ftmp%2Frepo");
  });

  it("rejects unsafe thread ids", () => {
    expect(buildThreadUrl("019f6995-c7a3-7601-9e00-1fda9de50d42")).toBe(
      "codex://threads/019f6995-c7a3-7601-9e00-1fda9de50d42",
    );
    expect(() => buildThreadUrl("../../bad")).toThrow(
      "Invalid Codex thread id",
    );
  });
});
