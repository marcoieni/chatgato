import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  liveUsage: vi.fn(),
  liveStatistics: vi.fn(),
  subscribe: vi.fn<
    (
      listener: (notification: {
        method: string;
        params: Record<string, unknown>;
      }) => void,
    ) => () => void
  >(() => () => undefined),
}));

vi.mock("../src/lib/codex-app-server.js", () => ({
  defaultCodexAppServer: {
    readAccountUsage: mocks.liveStatistics,
    readUsage: mocks.liveUsage,
    subscribe: mocks.subscribe,
  },
}));

import { UsageAction, UsageStatisticsAction } from "../src/actions/usage.js";

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
    mocks.liveStatistics.mockReset();
    mocks.subscribe.mockReset();
    mocks.subscribe.mockImplementation(() => () => undefined);
    mocks.liveUsage.mockResolvedValue({
      updatedAtMs: Date.now(),
      primary: {
        usedPercent: 1,
        windowMinutes: 10_080,
        resetsAtMs: Date.now() + 10_080 * 60_000,
      },
      secondary: null,
      planType: "pro",
      rateLimitReachedType: null,
      resetCredits: null,
      credits: null,
    });
    mocks.liveStatistics.mockResolvedValue({
      updatedAtMs: Date.now(),
      summary: {
        lifetimeTokens: 1_200_000,
        peakDailyTokens: 200_000,
        longestRunningTurnSeconds: 600,
        currentStreakDays: 3,
        longestStreakDays: 7,
      },
      dailyUsageBuckets: [{ startDate: "2026-08-30", tokens: 20_000 }],
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

  it("refreshes limits immediately from the app-server push notification", async () => {
    let listener:
      | ((notification: {
          method: string;
          params: Record<string, unknown>;
        }) => void)
      | null = null;
    mocks.subscribe.mockImplementation((next) => {
      listener = next;
      return () => undefined;
    });
    const harness = actionHarness();
    const usage = new UsageAction();

    await usage.onWillAppear({
      action: harness.action,
      payload: { settings: { pollSeconds: 300 } },
    } as never);
    listener!({ method: "account/rateLimits/updated", params: {} });

    await vi.waitFor(() => expect(mocks.liveUsage).toHaveBeenCalledTimes(2));
    usage.onWillDisappear({ action: harness.action } as never);
  });

  it("renders token statistics and refreshes them from token-usage pushes", async () => {
    let listener:
      | ((notification: {
          method: string;
          params: Record<string, unknown>;
        }) => void)
      | null = null;
    mocks.subscribe.mockImplementation((next) => {
      listener = next;
      return () => undefined;
    });
    const harness = actionHarness();
    const statistics = new UsageStatisticsAction();

    await statistics.onWillAppear({
      action: harness.action,
      payload: { settings: { pollSeconds: 300 } },
    } as never);
    expect(harness.action.setImage.mock.calls[0]![0]).toContain(
      "data:image/svg+xml;base64,",
    );
    listener!({ method: "thread/tokenUsage/updated", params: {} });

    await vi.waitFor(() =>
      expect(mocks.liveStatistics).toHaveBeenCalledTimes(2),
    );
    statistics.onWillDisappear({ action: harness.action } as never);
  });
});
