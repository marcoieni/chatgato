import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSettings, CodexThread } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
  openThreadBySearch:
    vi.fn<(title: string, resultIndex: number) => Promise<void>>(),
  openUrl: vi.fn<(url: string) => Promise<void>>(),
  threadSearchResult:
    vi.fn<
      (threadId: string) => Promise<{ resultIndex: number; title: string }>
    >(),
  threadAtSlot:
    vi.fn<(slot: number, cwdFilter?: string) => Promise<CodexThread | null>>(),
}));

vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: {
      createScope: () => ({ error: mocks.logError }),
    },
  },
  action:
    () =>
    <T>(target: T) =>
      target,
  SingletonAction: class {},
}));

vi.mock("../src/lib/codex-controller.js", () => ({
  openThreadBySearch: mocks.openThreadBySearch,
  openUrl: mocks.openUrl,
}));

vi.mock("../src/lib/codex-store.js", () => ({
  CodexStore: class {
    threadSearchResult = mocks.threadSearchResult;
    threadAtSlot = mocks.threadAtSlot;
  },
}));

import { AgentStatusAction } from "../src/actions/agent-status.js";

function thread(overrides: Partial<CodexThread> = {}): CodexThread {
  return {
    cwd: "/tmp/project",
    id: "thread-1",
    reasoningEffort: null,
    rolloutPath: "/tmp/rollout.jsonl",
    spawnStatus: null,
    status: "idle",
    title: "Task one",
    updatedAtMs: 100,
    ...overrides,
  };
}

function actionHarness(settings: AgentSettings = { slot: 1 }) {
  const action = {
    getSettings: vi.fn(async () => settings),
    id: "agent-status-test",
    setImage: vi.fn(async (_image: string) => undefined),
    setSettings: vi.fn(async (_settings: AgentSettings) => undefined),
    setTitle: vi.fn(async (_title: string) => undefined),
    showAlert: vi.fn(async () => undefined),
  };
  return action;
}

function decodedSvg(image: string): string {
  return Buffer.from(image.split(",")[1]!, "base64").toString();
}

describe("AgentStatusAction navigation", () => {
  beforeEach(() => {
    mocks.logError.mockReset();
    mocks.openUrl.mockReset();
    mocks.openUrl.mockResolvedValue();
    mocks.openThreadBySearch.mockReset();
    mocks.openThreadBySearch.mockResolvedValue();
    mocks.threadSearchResult.mockReset();
    mocks.threadSearchResult.mockResolvedValue({
      resultIndex: 0,
      title: "Task one",
    });
    mocks.threadAtSlot.mockReset();
    mocks.threadAtSlot.mockResolvedValue(null);
  });

  it("keeps exact deep-link navigation for local tasks", async () => {
    const selected = thread();
    mocks.threadAtSlot.mockResolvedValue(selected);
    const action = actionHarness();

    await new AgentStatusAction().onKeyDown({
      action,
      payload: { settings: { slot: 2 } },
    } as never);

    expect(mocks.openUrl).toHaveBeenCalledWith("codex://threads/thread-1");
    expect(action.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ acknowledgedThreadId: "thread-1", slot: 2 }),
    );
    expect(action.showAlert).not.toHaveBeenCalled();
  });

  it("navigates SSH-hosted tasks through the host-aware chat search", async () => {
    const selected = thread({
      id: "remote-thread",
      remoteHostId: "remote-ssh-discovered:devbox",
      title: "Remote task",
    });
    mocks.threadAtSlot.mockResolvedValue(selected);
    mocks.threadSearchResult.mockResolvedValue({
      resultIndex: 1,
      title: "Remote task",
    });
    const action = actionHarness();

    await new AgentStatusAction().onKeyDown({
      action,
      payload: { settings: { slot: 3 } },
    } as never);

    expect(mocks.threadSearchResult).toHaveBeenCalledWith("remote-thread");
    expect(mocks.openThreadBySearch).toHaveBeenCalledWith("Remote task", 1);
    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(action.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        acknowledgedThreadId: "remote-thread",
        slot: 3,
      }),
    );
  });

  it("does not acknowledge a task when navigation fails", async () => {
    mocks.threadAtSlot.mockResolvedValue(thread());
    mocks.openUrl.mockRejectedValue(new Error("Codex unavailable"));
    const action = actionHarness();

    await new AgentStatusAction().onKeyDown({
      action,
      payload: { settings: { slot: 1 } },
    } as never);

    expect(action.setSettings).not.toHaveBeenCalled();
    expect(action.showAlert).toHaveBeenCalledOnce();
    expect(mocks.logError).toHaveBeenCalledWith(
      "Failed to open task in slot 1",
      expect.objectContaining({ message: "Codex unavailable" }),
    );
  });

  it("rotates the working spinner until the key disappears", async () => {
    vi.useFakeTimers();
    mocks.threadAtSlot.mockResolvedValue(thread({ status: "working" }));
    const action = actionHarness();
    const agentStatus = new AgentStatusAction();

    try {
      await agentStatus.onWillAppear({
        action,
        payload: { settings: { slot: 1 } },
      } as never);

      expect(action.setImage).toHaveBeenCalledOnce();
      expect(decodedSvg(action.setImage.mock.calls[0]![0])).toContain(
        'transform="rotate(0 28 30)"',
      );

      await vi.advanceTimersByTimeAsync(149);
      expect(action.setImage).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(action.setImage).toHaveBeenCalledTimes(2);
      expect(decodedSvg(action.setImage.mock.calls[1]![0])).toContain(
        'transform="rotate(22.5 28 30)"',
      );

      agentStatus.onWillDisappear({ action } as never);
      const stoppedAt = action.setImage.mock.calls.length;
      await vi.advanceTimersByTimeAsync(300);
      expect(action.setImage).toHaveBeenCalledTimes(stoppedAt);
    } finally {
      agentStatus.onWillDisappear({ action } as never);
      vi.useRealTimers();
    }
  });
});
