import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
  setPushToTalk: mocks.setPushToTalk,
}));

import { PushToTalkAction } from "../src/actions/push-to-talk.js";
import { PushToTalkSession } from "../src/lib/push-to-talk-session.js";

function actionInstance(id: string) {
  return {
    id,
    setImage: vi.fn(async (_image: string) => undefined),
    showAlert: vi.fn(async () => undefined),
  };
}

describe("PushToTalkAction", () => {
  beforeEach(() => {
    mocks.setPushToTalk.mockReset();
    mocks.setPushToTalk.mockResolvedValue();
  });

  it("starts dictation on key-down and stops it on key-up", async () => {
    const action = actionInstance("push-to-talk-test");
    const pushToTalk = new PushToTalkAction(new PushToTalkSession(mocks.setPushToTalk));

    await pushToTalk.onKeyDown({ action, payload: { settings: {} } } as never);
    await pushToTalk.onKeyUp({ action, payload: { settings: {} } } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true], [false]]);
    const images = action.setImage.mock.calls.map(([image]) =>
      Buffer.from(image.split(",")[1]!, "base64").toString(),
    );
    expect(images[0]).toContain("#FFD600");
    expect(images[1]).toContain("#071018");
    expect(action.showAlert).not.toHaveBeenCalled();
  });

  it("starts with the idle microphone color", async () => {
    const action = actionInstance("push-to-talk-test");
    const pushToTalk = new PushToTalkAction(new PushToTalkSession(mocks.setPushToTalk));

    await pushToTalk.onWillAppear({ action, payload: { settings: {} } } as never);

    const image = action.setImage.mock.calls.at(-1)![0];
    expect(Buffer.from(image.split(",")[1]!, "base64").toString()).toContain("#071018");
  });

  it("ignores key-repeat events", async () => {
    const action = actionInstance("push-to-talk-test");
    const pushToTalk = new PushToTalkAction(new PushToTalkSession(mocks.setPushToTalk));

    await pushToTalk.onKeyDown({ action, payload: { settings: {} } } as never);
    await pushToTalk.onKeyDown({ action, payload: { settings: {} } } as never);

    expect(mocks.setPushToTalk).toHaveBeenCalledOnce();
    expect(mocks.setPushToTalk).toHaveBeenCalledWith(true);
  });

  it("keeps dictation active until every held Push to Talk key is released", async () => {
    const first = actionInstance("first");
    const second = actionInstance("second");
    const pushToTalk = new PushToTalkAction(new PushToTalkSession(mocks.setPushToTalk));

    await pushToTalk.onKeyDown({ action: first, payload: { settings: {} } } as never);
    await pushToTalk.onKeyDown({ action: second, payload: { settings: {} } } as never);
    await pushToTalk.onKeyUp({ action: first, payload: { settings: {} } } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true]]);

    await pushToTalk.onKeyUp({ action: second, payload: { settings: {} } } as never);
    expect(mocks.setPushToTalk.mock.calls).toEqual([[true], [false]]);
  });

  it("releases dictation if the held action disappears", async () => {
    const action = actionInstance("push-to-talk-test");
    const pushToTalk = new PushToTalkAction(new PushToTalkSession(mocks.setPushToTalk));

    await pushToTalk.onKeyDown({ action, payload: { settings: {} } } as never);
    await pushToTalk.onWillDisappear({ action, payload: { settings: {} } } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true], [false]]);
  });

  it("alerts and releases the shortcut when dictation cannot start", async () => {
    mocks.setPushToTalk.mockRejectedValueOnce(new Error("Codex unavailable"));
    const action = actionInstance("push-to-talk-test");
    const pushToTalk = new PushToTalkAction(new PushToTalkSession(mocks.setPushToTalk));

    await pushToTalk.onKeyDown({ action, payload: { settings: {} } } as never);

    expect(mocks.setPushToTalk.mock.calls).toEqual([[true], [false]]);
    const image = action.setImage.mock.calls.at(-1)![0];
    expect(Buffer.from(image.split(",")[1]!, "base64").toString()).toContain("#071018");
    expect(action.showAlert).toHaveBeenCalledOnce();
  });
});
