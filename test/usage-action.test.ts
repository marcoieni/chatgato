import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  liveUsage: vi.fn(),
}));

vi.mock("../src/lib/codex-app-server.js", () => ({
  defaultCodexAppServer: {
    readUsage: mocks.liveUsage,
    subscribe: vi.fn(() => () => undefined),
  },
}));

import { UsageAction } from "../src/actions/usage.js";

function actionHarness() {
  const action = {
    id: "usage-test",
    setImage: vi.fn(async (_image: string) => undefined),
    setTitle: vi.fn(async (_title: string) => undefined),
  };
  return { action };
}

describe("UsageAction", () => {
  beforeEach(() => {
    mocks.liveUsage.mockReset();
    mocks.liveUsage.mockResolvedValue({
      updatedAtMs: Date.now(),
      primary: {
        usedPercent: 1,
        windowMinutes: 10_080,
        resetsAtMs: Date.now() + 10_080 * 60_000,
      },
      secondary: null,
      planType: "pro",
      credits: null,
    });
  });

  it("refreshes immediately when pressed", async () => {
    const harness = actionHarness();
    const usage = new UsageAction();

    await usage.onKeyDown({ action: harness.action } as never);

    expect(mocks.liveUsage).toHaveBeenCalledOnce();
    expect(harness.action.setImage).toHaveBeenCalledOnce();
    expect(harness.action.setTitle).toHaveBeenCalledWith("");
  });

  it("renders the offline state when an immediate refresh fails", async () => {
    mocks.liveUsage.mockRejectedValueOnce(new Error("Codex unavailable"));
    const harness = actionHarness();
    const usage = new UsageAction();

    await usage.onKeyDown({ action: harness.action } as never);

    const image = harness.action.setImage.mock.calls[0]![0];
    expect(Buffer.from(image.split(",")[1]!, "base64").toString()).toContain(
      "OFFLINE",
    );
  });
});
