import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn<(command: string) => Promise<void>>(),
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

import { ApproveAction } from "../src/actions/approve.js";
import { DeclineAction } from "../src/actions/decline.js";

function actionInstance() {
  return {
    showAlert: vi.fn(async () => undefined),
  };
}

describe("decision actions", () => {
  beforeEach(() => {
    mocks.executeCommand.mockReset();
    mocks.executeCommand.mockResolvedValue();
  });

  it("approves from its dedicated action", async () => {
    const action = actionInstance();

    await new ApproveAction().onKeyDown({ action, payload: { settings: {} } } as never);

    expect(mocks.executeCommand).toHaveBeenCalledWith("approve");
    expect(action.showAlert).not.toHaveBeenCalled();
  });

  it("declines from its dedicated action", async () => {
    const action = actionInstance();

    await new DeclineAction().onKeyDown({ action, payload: { settings: {} } } as never);

    expect(mocks.executeCommand).toHaveBeenCalledWith("decline");
    expect(action.showAlert).not.toHaveBeenCalled();
  });

  it("alerts when a decision shortcut fails", async () => {
    mocks.executeCommand.mockRejectedValueOnce(new Error("Codex unavailable"));
    const action = actionInstance();

    await new ApproveAction().onKeyDown({ action, payload: { settings: {} } } as never);

    expect(action.showAlert).toHaveBeenCalledOnce();
  });
});
