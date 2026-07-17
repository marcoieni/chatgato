import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn<(command: string) => Promise<void>>(),
}));

vi.mock("@elgato/streamdeck", () => ({
  action:
    () =>
    <T>(target: T) =>
      target,
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

import {
  ForkAction,
  GoBackAction,
  GoForwardAction,
  OpenReviewAction,
  PlanAction,
  ReviewTabAction,
  ScheduledAction,
  SettingsAction,
  SkillsAction,
  SubmitAction,
  ToggleSidebarAction,
  ToggleTerminalAction,
} from "../src/actions/dedicated-command.js";

function actionInstance() {
  return {
    showAlert: vi.fn(async () => undefined),
  };
}

describe("dedicated command actions", () => {
  beforeEach(() => {
    mocks.executeCommand.mockReset();
    mocks.executeCommand.mockResolvedValue();
  });

  it.each([
    [SubmitAction, "submit"],
    [ForkAction, "forkThread"],
    [ReviewTabAction, "review"],
    [ToggleTerminalAction, "terminal"],
    [OpenReviewAction, "openReview"],
    [SettingsAction, "settings"],
    [PlanAction, "togglePlan"],
    [SkillsAction, "skills"],
    [ScheduledAction, "scheduled"],
    [GoBackAction, "navigateBack"],
    [GoForwardAction, "navigateForward"],
    [ToggleSidebarAction, "toggleSidebar"],
  ])(
    "routes %s through the shared controller",
    async (ActionClass, command) => {
      const dedicatedAction = new ActionClass();

      await dedicatedAction.onKeyDown({
        action: actionInstance(),
        payload: { settings: {} },
      } as never);

      expect(mocks.executeCommand).toHaveBeenCalledWith(command);
    },
  );

  it("shows an alert when a command fails", async () => {
    const action = actionInstance();
    mocks.executeCommand.mockRejectedValueOnce(new Error("automation failed"));

    await new SubmitAction().onKeyDown({
      action,
      payload: { settings: {} },
    } as never);

    expect(action.showAlert).toHaveBeenCalledOnce();
  });
});
