import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSettings, CodexThread } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  logError: vi.fn(),
  openThreadBySearch:
    vi.fn<(title: string, resultIndex: number) => Promise<void>>(),
  openUrl: vi.fn<(url: string) => Promise<void>>(),
  threadSearchResultIndex:
    vi.fn<(threadId: string, title: string) => Promise<number>>(),
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
    threadSearchResultIndex = mocks.threadSearchResultIndex;
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

function actionHarness() {
  const action = {
    id: "agent-status-test",
    setSettings: vi.fn(async (_settings: AgentSettings) => undefined),
    showAlert: vi.fn(async () => undefined),
  };
  return action;
}

describe("AgentStatusAction navigation", () => {
  beforeEach(() => {
    mocks.logError.mockReset();
    mocks.openUrl.mockReset();
    mocks.openUrl.mockResolvedValue();
    mocks.openThreadBySearch.mockReset();
    mocks.openThreadBySearch.mockResolvedValue();
    mocks.threadSearchResultIndex.mockReset();
    mocks.threadSearchResultIndex.mockResolvedValue(0);
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
    mocks.threadSearchResultIndex.mockResolvedValue(1);
    const action = actionHarness();

    await new AgentStatusAction().onKeyDown({
      action,
      payload: { settings: { slot: 3 } },
    } as never);

    expect(mocks.threadSearchResultIndex).toHaveBeenCalledWith(
      "remote-thread",
      "Remote task",
    );
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
});
