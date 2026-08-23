import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastModeStates } from "../src/lib/codex-store.js";
import type { FastModeSettings } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  fastModeStates:
    vi.fn<(forceRemoteRefresh?: boolean) => Promise<FastModeStates>>(),
  executeCommand: vi.fn<(command: string) => Promise<void>>(),
}));

vi.mock("../src/lib/codex-controller.js", () => ({
  executeCommand: mocks.executeCommand,
}));

vi.mock("../src/lib/codex-store.js", () => ({
  CodexStore: class {
    fastModeStates = mocks.fastModeStates;
  },
}));

import { FastModeAction } from "../src/actions/fast-mode.js";

function modeStates(
  localEnabled: boolean,
  remoteEnabled: boolean | null,
  selectionId = remoteEnabled === null ? "local" : "remote:selected-project",
): FastModeStates {
  return { localEnabled, remoteEnabled, selectionId };
}

function actionHarness(initial: FastModeSettings = {}) {
  let settings = initial;
  const action = {
    id: "fast-mode-test",
    getSettings: vi.fn(async () => settings),
    setSettings: vi.fn(async (next: FastModeSettings) => {
      settings = next;
    }),
    setImage: vi.fn(async (_image: string) => undefined),
    setTitle: vi.fn(async () => undefined),
    showAlert: vi.fn(async () => undefined),
  };
  return { action, settings: () => settings };
}

describe("FastModeAction", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.fastModeStates.mockReset();
    mocks.fastModeStates.mockResolvedValue(modeStates(false, null));
    mocks.executeCommand.mockReset();
    mocks.executeCommand.mockResolvedValue();
  });

  it("routes through the Fast keyboard shortcut and confirms the on state", async () => {
    mocks.fastModeStates
      .mockResolvedValueOnce(modeStates(false, null))
      .mockResolvedValue(modeStates(true, null));
    const harness = actionHarness();
    const fastMode = new FastModeAction();

    await fastMode.onKeyDown({
      action: harness.action,
      payload: { settings: {} },
    } as never);

    expect(mocks.executeCommand).toHaveBeenCalledWith("toggleFast");
    expect(mocks.fastModeStates).toHaveBeenNthCalledWith(1, true);
    expect(mocks.fastModeStates).toHaveBeenLastCalledWith(true);
    expect(harness.action.setSettings).not.toHaveBeenCalled();
    expect(harness.action.setImage).toHaveBeenLastCalledWith(
      expect.stringMatching(/^data:image\/svg\+xml;base64,/),
    );
    const onImage = harness.action.setImage.mock.calls.at(-1)![0];
    expect(Buffer.from(onImage.split(",")[1]!, "base64").toString()).toContain(
      "#FFD600",
    );
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nON");
  });

  it("changes back to off on the next press", async () => {
    mocks.fastModeStates
      .mockResolvedValueOnce(modeStates(true, null))
      .mockResolvedValue(modeStates(false, null));
    const harness = actionHarness({ enabled: true });
    const fastMode = new FastModeAction();

    await fastMode.onKeyDown({
      action: harness.action,
      payload: { settings: { enabled: true } },
    } as never);

    expect(harness.action.setSettings).not.toHaveBeenCalled();
    const offImage = harness.action.setImage.mock.calls.at(-1)![0];
    expect(Buffer.from(offImage.split(",")[1]!, "base64").toString()).toContain(
      "#303840",
    );
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nOFF");
  });

  it("keeps the previous state and alerts when Codex cannot toggle", async () => {
    mocks.executeCommand.mockRejectedValueOnce(new Error("Codex unavailable"));
    const harness = actionHarness();
    const fastMode = new FastModeAction();

    await fastMode.onKeyDown({
      action: harness.action,
      payload: { settings: {} },
    } as never);

    expect(harness.action.setSettings).not.toHaveBeenCalled();
    expect(harness.settings()).toEqual({});
    expect(harness.action.showAlert).toHaveBeenCalledOnce();
  });

  it("keeps the off state and alerts when persisted state does not change", async () => {
    vi.useFakeTimers();
    const harness = actionHarness();
    const fastMode = new FastModeAction();

    const toggled = fastMode.onKeyDown({
      action: harness.action,
      payload: { settings: {} },
    } as never);
    await vi.advanceTimersByTimeAsync(2_100);
    await toggled;

    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nOFF");
    expect(harness.action.showAlert).toHaveBeenCalledOnce();
  });

  it("renders Codex's persisted state instead of a stale Stream Deck setting", async () => {
    const harness = actionHarness({ enabled: true });
    const fastMode = new FastModeAction();

    await fastMode.onWillAppear({
      action: harness.action,
      payload: { settings: { enabled: true } },
    } as never);

    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nOFF");
    expect(harness.action.setSettings).not.toHaveBeenCalled();
    fastMode.onWillDisappear({ action: harness.action } as never);
  });

  it("polls Codex so changes made in the app update the key", async () => {
    vi.useFakeTimers();
    mocks.fastModeStates
      .mockResolvedValueOnce(modeStates(false, null))
      .mockResolvedValue(modeStates(true, null));
    const harness = actionHarness();
    const fastMode = new FastModeAction();

    await fastMode.onWillAppear({
      action: harness.action,
      payload: { settings: {} },
    } as never);
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nOFF");

    await vi.advanceTimersByTimeAsync(1_000);

    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nON");
    fastMode.onWillDisappear({ action: harness.action } as never);
  });

  it("detects a local toggle when the desktop still reports a remote project", async () => {
    mocks.fastModeStates
      .mockResolvedValueOnce(modeStates(false, false))
      .mockResolvedValue(modeStates(true, false));
    const harness = actionHarness();
    const fastMode = new FastModeAction();

    await fastMode.onKeyDown({
      action: harness.action,
      payload: { settings: {} },
    } as never);

    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nON");
    expect(harness.action.showAlert).not.toHaveBeenCalled();

    await fastMode.onWillAppear({
      action: harness.action,
      payload: { settings: {} },
    } as never);
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nON");
    fastMode.onWillDisappear({ action: harness.action } as never);
  });

  it("detects a remote toggle independently from the local config", async () => {
    mocks.fastModeStates
      .mockResolvedValueOnce(modeStates(false, false))
      .mockResolvedValue(modeStates(false, true));
    const harness = actionHarness();
    const fastMode = new FastModeAction();

    await fastMode.onKeyDown({
      action: harness.action,
      payload: { settings: {} },
    } as never);

    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nON");
    expect(harness.action.showAlert).not.toHaveBeenCalled();
  });

  it("uses the selected remote state after switching away from a local toggle", async () => {
    mocks.fastModeStates
      .mockResolvedValueOnce(modeStates(false, null))
      .mockResolvedValueOnce(modeStates(true, null))
      .mockResolvedValue(
        modeStates(true, false, "remote:newly-selected-project"),
      );
    const harness = actionHarness();
    const fastMode = new FastModeAction();

    await fastMode.onKeyDown({
      action: harness.action,
      payload: { settings: {} },
    } as never);
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nON");

    await fastMode.onWillAppear({
      action: harness.action,
      payload: { settings: {} },
    } as never);

    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nOFF");
    fastMode.onWillDisappear({ action: harness.action } as never);
  });

  it("force-refreshes a stale remote baseline before toggling", async () => {
    let forcedReads = 0;
    mocks.fastModeStates.mockImplementation(async (forceRemoteRefresh) => {
      if (!forceRemoteRefresh) return modeStates(false, false);
      forcedReads += 1;
      return forcedReads === 1
        ? modeStates(false, true)
        : modeStates(false, false);
    });
    const harness = actionHarness();
    const fastMode = new FastModeAction();

    await fastMode.onKeyDown({
      action: harness.action,
      payload: { settings: {} },
    } as never);

    expect(mocks.fastModeStates).toHaveBeenNthCalledWith(1, true);
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nOFF");
    expect(harness.action.showAlert).not.toHaveBeenCalled();
  });
});
