import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { openT3Code } from "../src/lib/codex-controller.js";

const originalPlatform = process.platform;
afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform });
  vi.resetAllMocks();
});

function launcher(platform: string, exitCode = 0) {
  Object.defineProperty(process, "platform", { value: platform });
  mocks.spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stderr: new PassThrough(),
    });
    queueMicrotask(() => {
      if (exitCode) child.stderr.write("Application unavailable");
      child.emit("exit", exitCode);
    });
    return child;
  });
}

describe("T3 Code desktop launcher", () => {
  it("opens the bundle directly on macOS without relying on thread links", async () => {
    launcher("darwin");
    await openT3Code();
    expect(mocks.spawn).toHaveBeenCalledWith(
      "/usr/bin/open",
      ["-b", "com.t3tools.t3code"],
      expect.anything(),
    );
  });

  it("uses the registered T3 Code protocol on Windows", async () => {
    launcher("win32");
    await openT3Code();
    expect(mocks.spawn).toHaveBeenCalledWith(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        expect.stringContaining("codex-control.ps1"),
        "url",
        "t3code://app/",
      ],
      expect.anything(),
    );
  });

  it("propagates launcher failures so the key can alert without acknowledging", async () => {
    launcher("darwin", 1);
    await expect(openT3Code()).rejects.toThrow("Application unavailable");
  });
});
