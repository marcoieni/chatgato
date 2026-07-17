import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setPushToTalk: vi.fn<(active: boolean) => Promise<void>>(),
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
  setPushToTalk: mocks.setPushToTalk,
}));

import { PushToTalkAction } from "../src/actions/push-to-talk.js";
import { TapToTalkAction } from "../src/actions/tap-to-talk.js";
import { PushToTalkSession } from "../src/lib/push-to-talk-session.js";

function actionInstance(id: string) {
  return {
    id,
    setImage: vi.fn(async (_image: string) => undefined),
    setTitle: vi.fn(async (_title: string) => undefined),
    showAlert: vi.fn(async () => undefined),
  };
}

describe("TapToTalkAction", () => {
  beforeEach(() => {
    mocks.setPushToTalk.mockReset();
    mocks.setPushToTalk.mockResolvedValue();
  });

  it("starts on one press and stops on the next press", async () => {
    const action = actionInstance("tap-to-talk-test");
    const tapToTalk = new TapToTalkAction(
      new PushToTalkSession(mocks.setPushToTalk),
    );

    await tapToTalk.onKeyDown({ action, payload: { settings: {} } } as never);
    tapToTalk.onKeyUp({ action, payload: { settings: {} } } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true]]);
    expect(action.setTitle).toHaveBeenLastCalledWith("TAP\nTO STOP");

    await tapToTalk.onKeyDown({ action, payload: { settings: {} } } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true], [false]]);
    expect(action.setTitle).toHaveBeenLastCalledWith("TAP\nTO TALK");
    expect(action.showAlert).not.toHaveBeenCalled();
  });

  it("does not stop when the first press is released", async () => {
    const action = actionInstance("tap-to-talk-test");
    const tapToTalk = new TapToTalkAction(
      new PushToTalkSession(mocks.setPushToTalk),
    );

    await tapToTalk.onKeyDown({ action, payload: { settings: {} } } as never);
    tapToTalk.onKeyUp({ action, payload: { settings: {} } } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true]]);
    const image = action.setImage.mock.calls.at(-1)![0];
    expect(Buffer.from(image.split(",")[1]!, "base64").toString()).toContain(
      "#FFD600",
    );
  });

  it("ignores repeated key-down events until the key is released", async () => {
    const action = actionInstance("tap-to-talk-test");
    const tapToTalk = new TapToTalkAction(
      new PushToTalkSession(mocks.setPushToTalk),
    );

    await tapToTalk.onKeyDown({ action, payload: { settings: {} } } as never);
    await tapToTalk.onKeyDown({ action, payload: { settings: {} } } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true]]);
    expect(action.setTitle).toHaveBeenLastCalledWith("TAP\nTO STOP");
  });

  it("shares dictation safely with a held Push to Talk key", async () => {
    const session = new PushToTalkSession(mocks.setPushToTalk);
    const tapAction = actionInstance("tap");
    const pushAction = actionInstance("push");
    const tapToTalk = new TapToTalkAction(session);
    const pushToTalk = new PushToTalkAction(session);

    await tapToTalk.onKeyDown({
      action: tapAction,
      payload: { settings: {} },
    } as never);
    tapToTalk.onKeyUp({
      action: tapAction,
      payload: { settings: {} },
    } as never);
    await pushToTalk.onKeyDown({
      action: pushAction,
      payload: { settings: {} },
    } as never);
    await tapToTalk.onKeyDown({
      action: tapAction,
      payload: { settings: {} },
    } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true]]);

    await pushToTalk.onKeyUp({
      action: pushAction,
      payload: { settings: {} },
    } as never);
    expect(mocks.setPushToTalk.mock.calls).toEqual([[true], [false]]);
  });

  it("stops dictation if an active action disappears", async () => {
    const action = actionInstance("tap-to-talk-test");
    const tapToTalk = new TapToTalkAction(
      new PushToTalkSession(mocks.setPushToTalk),
    );

    await tapToTalk.onKeyDown({ action, payload: { settings: {} } } as never);
    await tapToTalk.onWillDisappear({
      action,
      payload: { settings: {} },
    } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true], [false]]);
  });

  it("returns to idle and alerts when dictation cannot start", async () => {
    mocks.setPushToTalk.mockRejectedValueOnce(new Error("Codex unavailable"));
    const action = actionInstance("tap-to-talk-test");
    const tapToTalk = new TapToTalkAction(
      new PushToTalkSession(mocks.setPushToTalk),
    );

    await tapToTalk.onKeyDown({ action, payload: { settings: {} } } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true], [false]]);
    expect(action.setTitle).toHaveBeenLastCalledWith("TAP\nTO TALK");
    expect(action.showAlert).toHaveBeenCalledOnce();
  });
});
