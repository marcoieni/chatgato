import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlanModeSettings } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn<(command: string) => Promise<void>>(),
  planModeEnabled: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@elgato/streamdeck", () => ({
  action: () => <T>(target: T) => target,
  SingletonAction: class {},
  default: {
    logger: {
      createScope: () => ({ info: vi.fn(), error: vi.fn() }),
    },
  },
}));

vi.mock("../src/lib/codex-controller.js", () => ({
  executeCommand: mocks.executeCommand,
}));

vi.mock("../src/lib/codex-store.js", () => ({
  CodexStore: class {
    planModeEnabled = mocks.planModeEnabled;
  },
}));

import { PlanModeAction } from "../src/actions/plan-mode.js";

function actionHarness() {
  const action = {
    id: "plan-mode-test",
    setImage: vi.fn(async (_image: string) => undefined),
    setTitle: vi.fn(async (_title: string) => undefined),
    showAlert: vi.fn(async () => undefined),
  };
  return { action };
}

describe("PlanModeAction", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.executeCommand.mockReset();
    mocks.executeCommand.mockResolvedValue();
    mocks.planModeEnabled.mockReset();
    mocks.planModeEnabled.mockResolvedValue(false);
  });

  it("runs /plan and changes from the off visual to the on visual after confirmation", async () => {
    mocks.planModeEnabled.mockResolvedValueOnce(false).mockResolvedValue(true);
    const harness = actionHarness();
    const planMode = new PlanModeAction();

    await planMode.onKeyDown({
      action: harness.action,
      payload: { settings: {} satisfies PlanModeSettings },
    } as never);

    expect(mocks.executeCommand).toHaveBeenCalledWith("togglePlan");
    const image = harness.action.setImage.mock.calls.at(-1)![0];
    expect(Buffer.from(image.split(",")[1]!, "base64").toString()).toContain("#9E5BFF");
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("PLAN\nON");
    expect(harness.action.showAlert).not.toHaveBeenCalled();
  });

  it("changes back to the off visual on the next press", async () => {
    mocks.planModeEnabled.mockResolvedValueOnce(true).mockResolvedValue(false);
    const harness = actionHarness();
    const planMode = new PlanModeAction();

    await planMode.onKeyDown({ action: harness.action, payload: { settings: {} } } as never);

    const image = harness.action.setImage.mock.calls.at(-1)![0];
    expect(Buffer.from(image.split(",")[1]!, "base64").toString()).toContain("#303840");
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("PLAN\nOFF");
  });

  it("keeps Codex's current visual and alerts when the command fails", async () => {
    mocks.planModeEnabled.mockResolvedValue(false);
    mocks.executeCommand.mockRejectedValueOnce(new Error("Codex unavailable"));
    const harness = actionHarness();
    const planMode = new PlanModeAction();

    await planMode.onKeyDown({ action: harness.action, payload: { settings: {} } } as never);

    const image = harness.action.setImage.mock.calls.at(-1)![0];
    expect(Buffer.from(image.split(",")[1]!, "base64").toString()).toContain("#303840");
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("PLAN\nOFF");
    expect(harness.action.showAlert).toHaveBeenCalledOnce();
  });

  it("polls Codex for app-side changes and stops when the key disappears", async () => {
    vi.useFakeTimers();
    mocks.planModeEnabled.mockResolvedValueOnce(false).mockResolvedValue(true);
    const harness = actionHarness();
    const planMode = new PlanModeAction();

    await planMode.onWillAppear({ action: harness.action, payload: { settings: {} } } as never);
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("PLAN\nOFF");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.action.setTitle).toHaveBeenLastCalledWith("PLAN\nON");
    expect(mocks.planModeEnabled).toHaveBeenCalledTimes(2);

    planMode.onWillDisappear({ action: harness.action } as never);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.planModeEnabled).toHaveBeenCalledTimes(2);
  });
});
