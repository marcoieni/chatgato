import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSettings, CodexThread } from "../src/types.js";

const mocks = vi.hoisted(() => ({
  openThreadSlot: vi.fn<(slot: number) => Promise<void>>(),
  openUrl: vi.fn<(url: string) => Promise<void>>(),
  threadAtSlot:
    vi.fn<(slot: number, cwdFilter?: string) => Promise<CodexThread | null>>(),
}));

vi.mock("@elgato/streamdeck", () => ({
  action:
    () =>
    <T>(target: T) =>
      target,
  SingletonAction: class {},
}));

vi.mock("../src/lib/codex-controller.js", () => ({
  openThreadSlot: mocks.openThreadSlot,
  openUrl: mocks.openUrl,
}));

vi.mock("../src/lib/codex-store.js", () => ({
  CodexStore: class {
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
    mocks.openThreadSlot.mockReset();
    mocks.openThreadSlot.mockResolvedValue();
    mocks.openUrl.mockReset();
    mocks.openUrl.mockResolvedValue();
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
    expect(mocks.openThreadSlot).not.toHaveBeenCalled();
    expect(action.setSettings).toHaveBeenCalledWith(
      expect.objectContaining({ acknowledgedThreadId: "thread-1", slot: 2 }),
    );
    expect(action.showAlert).not.toHaveBeenCalled();
  });

  it("uses Codex's native numbered shortcut for SSH-hosted tasks", async () => {
    const selected = thread({
      id: "remote-thread",
      remoteHostId: "remote-ssh-discovered:devbox",
      title: "Remote task",
    });
    mocks.threadAtSlot.mockResolvedValue(selected);
    const action = actionHarness();

    await new AgentStatusAction().onKeyDown({
      action,
      payload: { settings: { slot: 3 } },
    } as never);

    expect(mocks.openThreadSlot).toHaveBeenCalledWith(3);
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
  });
});
