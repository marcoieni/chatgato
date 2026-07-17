import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runReasoning:
    vi.fn<(direction: "increase" | "decrease") => Promise<boolean>>(),
}));

vi.mock("@elgato/streamdeck", () => ({
  action:
    () =>
    <T>(target: T) =>
      target,
  SingletonAction: class {},
}));

vi.mock("../src/lib/codex-controller.js", () => ({
  runReasoning: mocks.runReasoning,
}));

import {
  DecreaseReasoningAction,
  IncreaseReasoningAction,
} from "../src/actions/reasoning.js";

type ManifestAction = {
  Controllers: string[];
  Icon: string;
  Name: string;
  UUID: string;
};

const manifest = JSON.parse(
  readFileSync(
    new URL("../com.marco.chatgato.sdPlugin/manifest.json", import.meta.url),
    "utf8",
  ),
) as { Actions: ManifestAction[] };

const propertyInspector = readFileSync(
  new URL("../com.marco.chatgato.sdPlugin/ui/pi.js", import.meta.url),
  "utf8",
);

function actionHarness() {
  return {
    setImage: vi.fn(async (_image: string) => undefined),
    setTitle: vi.fn(async (_title: string) => undefined),
    showAlert: vi.fn(async () => undefined),
  };
}

describe("Reasoning actions", () => {
  beforeEach(() => {
    mocks.runReasoning.mockReset();
    mocks.runReasoning.mockResolvedValue(true);
  });

  it("exposes separate increase and decrease keys plus an encoder-only dial", () => {
    expect(manifest.Actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Controllers: ["Keypad"],
          Icon: "imgs/action-list/reasoning-decrease",
          Name: "Decrease Reasoning",
          UUID: "com.marco.chatgato.decrease-reasoning",
        }),
        expect.objectContaining({
          Controllers: ["Keypad"],
          Icon: "imgs/action-list/reasoning-increase",
          Name: "Increase Reasoning",
          UUID: "com.marco.chatgato.increase-reasoning",
        }),
        expect.objectContaining({
          Controllers: ["Encoder"],
          Icon: "imgs/action-list/reasoning",
          Name: "Reasoning Dial",
          UUID: "com.marco.chatgato.reasoning",
        }),
      ]),
    );
  });

  it("routes each key through its fixed reasoning direction", async () => {
    const decrease = actionHarness();
    const increase = actionHarness();

    await new DecreaseReasoningAction().onKeyDown({
      action: decrease,
    } as never);
    await new IncreaseReasoningAction().onKeyDown({
      action: increase,
    } as never);

    expect(mocks.runReasoning.mock.calls).toEqual([["decrease"], ["increase"]]);
  });

  it("renders opposite arrows and labels for the two keys", async () => {
    const decrease = actionHarness();
    const increase = actionHarness();

    await new DecreaseReasoningAction().onWillAppear({
      action: decrease,
    } as never);
    await new IncreaseReasoningAction().onWillAppear({
      action: increase,
    } as never);

    expect(decrease.setTitle).toHaveBeenCalledWith("THINK\nLESS");
    expect(increase.setTitle).toHaveBeenCalledWith("THINK\nMORE");
    expect(decrease.setImage.mock.calls[0]![0]).not.toBe(
      increase.setImage.mock.calls[0]![0],
    );
    expect(decrease.setImage).toHaveBeenCalledWith(
      expect.stringContaining('fill="#fff"'),
    );
    expect(increase.setImage).toHaveBeenCalledWith(
      expect.stringContaining('fill="#fff"'),
    );
  });

  it("shows an alert when a reasoning change fails", async () => {
    const action = actionHarness();
    mocks.runReasoning.mockRejectedValueOnce(new Error("Codex unavailable"));

    await new DecreaseReasoningAction().onKeyDown({ action } as never);

    expect(action.showAlert).toHaveBeenCalledOnce();
  });

  it("does not offer a direction selector", () => {
    const reasoningInspector = propertyInspector.slice(
      propertyInspector.indexOf("function renderReasoning"),
      propertyInspector.indexOf("function renderUsage"),
    );

    expect(reasoningInspector).not.toContain("keyDirection");
  });
});
