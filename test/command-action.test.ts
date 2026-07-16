import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn<(command: string, palette?: string) => Promise<void>>(),
  setPushToTalk: vi.fn<(active: boolean) => Promise<void>>(),
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
  setPushToTalk: mocks.setPushToTalk,
}));

import { CommandAction } from "../src/actions/command.js";
import { PushToTalkSession } from "../src/lib/push-to-talk-session.js";

function actionInstance() {
  return {
    id: "command-test",
    showAlert: vi.fn(async () => undefined),
  };
}

describe("CommandAction", () => {
  beforeEach(() => {
    mocks.executeCommand.mockReset();
    mocks.executeCommand.mockResolvedValue();
    mocks.setPushToTalk.mockReset();
    mocks.setPushToTalk.mockResolvedValue();
  });

  it("keeps saved push-to-talk Command keys working", async () => {
    const action = actionInstance();
    const command = new CommandAction(new PushToTalkSession(mocks.setPushToTalk));

    await command.onKeyDown({ action, payload: { settings: { command: "ptt" } } } as never);
    await command.onKeyUp({ action, payload: { settings: { command: "ptt" } } } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true], [false]]);
    expect(mocks.executeCommand).not.toHaveBeenCalled();
  });

  it("continues to execute ordinary commands", async () => {
    const action = actionInstance();
    const command = new CommandAction(new PushToTalkSession(mocks.setPushToTalk));

    await command.onKeyDown({
      action,
      payload: { settings: { command: "review", paletteQuery: "Review task" } },
    } as never);

    expect(mocks.executeCommand).toHaveBeenCalledWith("review", "Review task");
    expect(mocks.setPushToTalk).not.toHaveBeenCalled();
  });

  it("defaults new unconfigured keys to the first remaining generic command", async () => {
    const action = actionInstance();
    const command = new CommandAction(new PushToTalkSession(mocks.setPushToTalk));

    await command.onKeyDown({ action, payload: { settings: {} } } as never);

    expect(mocks.executeCommand).toHaveBeenCalledWith("environmentAction", undefined);
  });
});
