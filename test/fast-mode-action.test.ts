import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastModeSettings } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  fastModeEnabled: vi.fn<() => Promise<boolean>>(),
  setFastMode: vi.fn<(enabled: boolean) => Promise<void>>(),
}));

vi.mock("../src/lib/codex-app-server.js", () => ({
  CodexAppServerConfigClient: class {
    setFastMode = mocks.setFastMode;
  },
}));

vi.mock("../src/lib/codex-store.js", () => ({
  CodexStore: class {
    fastModeEnabled = mocks.fastModeEnabled;
  },
}));

import { FastModeAction } from "../src/actions/fast-mode.js";

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
    mocks.fastModeEnabled.mockReset();
    mocks.fastModeEnabled.mockResolvedValue(false);
    mocks.setFastMode.mockReset();
    mocks.setFastMode.mockResolvedValue();
  });

  it("persists Fast through Codex's app-server and confirms the on state", async () => {
    mocks.fastModeEnabled.mockResolvedValueOnce(false).mockResolvedValue(true);
    const harness = actionHarness();
    const fastMode = new FastModeAction();

    await fastMode.onKeyDown({
      action: harness.action,
      payload: { settings: {} },
    } as never);

    expect(mocks.setFastMode).toHaveBeenCalledWith(true);
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
    mocks.fastModeEnabled.mockResolvedValueOnce(true).mockResolvedValue(false);
    const harness = actionHarness();
    const fastMode = new FastModeAction();

    await fastMode.onKeyDown({
      action: harness.action,
      payload: { settings: {} },
    } as never);

    expect(mocks.setFastMode).toHaveBeenCalledWith(false);
    expect(harness.action.setSettings).not.toHaveBeenCalled();
    const offImage = harness.action.setImage.mock.calls.at(-1)![0];
    expect(Buffer.from(offImage.split(",")[1]!, "base64").toString()).toContain(
      "#303840",
    );
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nOFF");
  });

  it("keeps the previous state and alerts when Codex cannot toggle", async () => {
    mocks.setFastMode.mockRejectedValueOnce(new Error("Codex unavailable"));
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
    mocks.fastModeEnabled.mockResolvedValue(false);
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

  it("renders Codex's persisted state on appear", async () => {
    mocks.fastModeEnabled.mockResolvedValue(false);
    const harness = actionHarness();
    const fastMode = new FastModeAction();

    await fastMode.onWillAppear({
      action: harness.action,
      payload: { settings: {} },
    } as never);

    expect(harness.action.setTitle).toHaveBeenLastCalledWith("FAST\nOFF");
    expect(harness.action.setSettings).not.toHaveBeenCalled();
    fastMode.onWillDisappear({ action: harness.action } as never);
  });

  it("polls Codex so changes made in the app update the key", async () => {
    vi.useFakeTimers();
    mocks.fastModeEnabled.mockResolvedValueOnce(false).mockResolvedValue(true);
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
});
