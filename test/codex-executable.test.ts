import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCodexExecutable } from "../src/lib/codex-executable.js";

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));

afterEach(() => vi.resetAllMocks());

describe("Codex executable discovery", () => {
  it.each([
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Users/test/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/Users/test/Applications/ChatGPT.app/Contents/Resources/codex",
  ])("finds the bundled macOS executable at %s", (executable) => {
    vi.mocked(existsSync).mockImplementation((path) => path === executable);

    expect(defaultCodexExecutable("darwin", "/Users/test")).toBe(executable);
  });

  it("prefers the current app bundle layout when both layouts exist", () => {
    vi.mocked(existsSync).mockReturnValue(true);

    expect(defaultCodexExecutable("darwin", "/Users/test")).toBe(
      "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    );
  });

  it("falls back to PATH when no macOS app executable exists", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(defaultCodexExecutable("darwin", "/Users/test")).toBe("codex");
  });
});
