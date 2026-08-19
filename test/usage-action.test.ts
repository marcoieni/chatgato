import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fallbackUsage: vi.fn(),
  liveUsage: vi.fn(),
}));

vi.mock("../src/lib/codex-store.js", () => ({
  CodexStore: class {
    latestUsage = mocks.fallbackUsage;
  },
}));

vi.mock("../src/lib/codex-app-server.js", () => ({
  CodexAppServerUsageClient: class {
    readUsage = mocks.liveUsage;
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
    mocks.fallbackUsage.mockReset();
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
    expect(mocks.fallbackUsage).not.toHaveBeenCalled();
    expect(harness.action.setImage).toHaveBeenCalledOnce();
    expect(harness.action.setTitle).toHaveBeenCalledWith("");
  });

  it("uses rollout usage when the initial live refresh fails", async () => {
    mocks.liveUsage.mockRejectedValueOnce(new Error("Codex unavailable"));
    mocks.fallbackUsage.mockResolvedValueOnce({
      updatedAtMs: 1,
      primary: { usedPercent: 25, windowMinutes: 300, resetsAtMs: null },
      secondary: null,
      planType: null,
      credits: null,
    });
    const harness = actionHarness();
    const usage = new UsageAction();

    await usage.onKeyDown({ action: harness.action } as never);

    expect(mocks.fallbackUsage).toHaveBeenCalledOnce();
    const image = harness.action.setImage.mock.calls[0]![0];
    expect(Buffer.from(image.split(",")[1]!, "base64").toString()).toContain(
      "75%",
    );
  });

  it("renders the offline state when an immediate refresh fails", async () => {
    mocks.liveUsage.mockRejectedValueOnce(new Error("Codex unavailable"));
    mocks.fallbackUsage.mockRejectedValueOnce(
      new Error("Rollouts unavailable"),
    );
    const harness = actionHarness();
    const usage = new UsageAction();

    await usage.onKeyDown({ action: harness.action } as never);

    const image = harness.action.setImage.mock.calls[0]![0];
    expect(Buffer.from(image.split(",")[1]!, "base64").toString()).toContain(
      "OFFLINE",
    );
  });
});
