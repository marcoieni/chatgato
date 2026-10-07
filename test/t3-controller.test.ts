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

const target = { threadId: "thread-123", environmentId: "environment-456" };

describe("T3 Code desktop launcher", () => {
  it("opens the exact thread through the macOS search helper", async () => {
    launcher("darwin");
    await openT3Code(target);
    expect(mocks.spawn).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        expect.stringContaining("t3-control.jxa.js"),
        target.threadId,
        target.environmentId,
      ],
      expect.anything(),
    );
  });

  it("uses the registered T3 Code protocol on Windows", async () => {
    launcher("win32");
    await openT3Code(target);
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
    await expect(openT3Code(target)).rejects.toThrow("Application unavailable");
  });

  it.each([
    undefined,
    { threadId: "bad\nidentity" },
    { threadId: "ok", environmentId: "../other" },
  ])(
    "rejects missing or unsafe identities before touching the UI: %j",
    async (ref) => {
      launcher("darwin");
      await expect(openT3Code(ref)).rejects.toThrow("thread identity");
      expect(mocks.spawn).not.toHaveBeenCalled();
    },
  );

  it("serializes adjacent presses and recovers after failed navigation", async () => {
    launcher("darwin");
    const children: EventEmitter[] = [];
    mocks.spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        stderr: new PassThrough(),
      });
      children.push(child);
      return child;
    });
    const first = openT3Code(target);
    const rejected = expect(first).rejects.toThrow("exited with code 1");
    const second = openT3Code({ ...target, threadId: "second-thread" });
    await vi.waitFor(() => expect(children).toHaveLength(1));
    children[0]!.emit("exit", 1);
    await rejected;
    await vi.waitFor(() => expect(children).toHaveLength(2));
    expect(mocks.spawn.mock.calls[1]![1]).toContain("second-thread");
    children[1]!.emit("exit", 0);
    await second;
  });
});
