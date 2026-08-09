import {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { normalizeAgentSlot } from "../lib/agent-slots.js";
import { ActionPoller, pollIntervalMs } from "../lib/action-poller.js";
import { CodexStore } from "../lib/codex-store.js";
import { buildThreadUrl } from "../lib/deep-links.js";
import { openThreadBySearch, openUrl } from "../lib/codex-controller.js";
import { agentImage, effectiveStatus } from "../lib/visuals.js";
import type { AgentSettings, CodexThread } from "../types.js";

type VisibleAction = WillAppearEvent<AgentSettings>["action"];
type WorkingAnimation = {
  actionInstance: VisibleAction;
  frame: number;
  rendering: Promise<void> | null;
  slot: number;
  thread: CodexThread;
  timer: NodeJS.Timeout | null;
};

const WORKING_FRAME_INTERVAL_MS = 100;
const WORKING_FRAME_COUNT = 16;
const WORKING_FRAME_DEGREES = 360 / WORKING_FRAME_COUNT;
const logger = streamDeck.logger.createScope("Agent Status");

@action({ UUID: "com.marco.chatgato.agent-status" })
export class AgentStatusAction extends SingletonAction<AgentSettings> {
  private readonly store = new CodexStore();
  private readonly poller = new ActionPoller();
  private readonly visibleActions = new Set<string>();
  private readonly visibleThreads = new Map<string, CodexThread>();
  private readonly workingAnimations = new Map<string, WorkingAnimation>();

  override async onWillAppear(
    ev: WillAppearEvent<AgentSettings>,
  ): Promise<void> {
    this.visibleActions.add(ev.action.id);
    await this.startPolling(ev.action, ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<AgentSettings>): void {
    this.visibleActions.delete(ev.action.id);
    this.poller.stop(ev.action.id);
    void this.stopWorkingAnimation(ev.action.id);
    this.visibleThreads.delete(ev.action.id);
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<AgentSettings>,
  ): Promise<void> {
    await this.startPolling(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<AgentSettings>): Promise<void> {
    const slot = this.slot(ev.payload.settings);
    try {
      const thread =
        this.visibleThreads.get(ev.action.id) ??
        (await this.store.threadAtSlot(slot, ev.payload.settings.cwdFilter));
      if (!thread) {
        await ev.action.showAlert();
        return;
      }

      if (thread.remoteHostId) {
        // Codex's external thread deep link only checks the local app server.
        // Its chat switcher retains each result's host-aware thread key.
        const result = await this.store.threadSearchResult(thread.id);
        await openThreadBySearch(result.title, result.resultIndex);
      } else {
        await openUrl(buildThreadUrl(thread.id));
      }

      await ev.action.setSettings({
        ...ev.payload.settings,
        acknowledgedThreadId: thread.id,
        acknowledgedAtMs: Date.now(),
      });
    } catch (error) {
      logger.error(`Failed to open task in slot ${slot}`, error);
      await ev.action.showAlert();
    }
  }

  private async startPolling(
    actionInstance: VisibleAction,
    settings: AgentSettings,
  ): Promise<void> {
    let firstRun = true;
    await this.poller.start(
      actionInstance.id,
      async () => {
        const currentSettings = firstRun
          ? settings
          : await actionInstance.getSettings<AgentSettings>();
        firstRun = false;
        await this.refresh(actionInstance, currentSettings);
      },
      pollIntervalMs(settings.pollSeconds, 2, 1, 30),
      () => actionInstance.showAlert(),
    );
  }

  private async refresh(
    actionInstance: VisibleAction,
    settings: AgentSettings,
  ): Promise<void> {
    const slot = this.slot(settings);
    await this.stopWorkingAnimation(actionInstance.id);
    try {
      const thread = await this.store.threadAtSlot(slot, settings.cwdFilter);
      if (!thread) {
        this.visibleThreads.delete(actionInstance.id);
        await Promise.all([
          actionInstance.setImage(agentImage(slot, "off")),
          actionInstance.setTitle(""),
        ]);
        return;
      }

      this.visibleThreads.set(actionInstance.id, thread);
      const status = effectiveStatus(
        thread,
        settings.acknowledgedThreadId,
        settings.acknowledgedAtMs,
      );
      await Promise.all([
        actionInstance.setImage(agentImage(slot, status, thread)),
        actionInstance.setTitle(""),
      ]);
      if (status === "working") {
        this.startWorkingAnimation(actionInstance, slot, thread);
      }
    } catch {
      this.visibleThreads.delete(actionInstance.id);
      await Promise.all([
        actionInstance.setImage(agentImage(slot, "error")),
        actionInstance.setTitle(""),
      ]);
    }
  }

  private slot(settings: AgentSettings): number {
    return normalizeAgentSlot(settings.slot);
  }

  private startWorkingAnimation(
    actionInstance: VisibleAction,
    slot: number,
    thread: CodexThread,
  ): void {
    if (!this.visibleActions.has(actionInstance.id)) return;

    const animation: WorkingAnimation = {
      actionInstance,
      frame: 0,
      rendering: null,
      slot,
      thread,
      timer: null,
    };
    this.workingAnimations.set(actionInstance.id, animation);
    this.scheduleWorkingFrame(actionInstance.id, animation);
  }

  private scheduleWorkingFrame(id: string, animation: WorkingAnimation): void {
    const timer = setTimeout(() => {
      if (
        this.workingAnimations.get(id) !== animation ||
        animation.timer !== timer
      ) {
        return;
      }

      animation.timer = null;
      const rendering = this.renderWorkingFrame(id, animation);
      animation.rendering = rendering;
      void rendering.finally(() => {
        if (animation.rendering === rendering) animation.rendering = null;
        if (this.workingAnimations.get(id) === animation) {
          this.scheduleWorkingFrame(id, animation);
        }
      });
    }, WORKING_FRAME_INTERVAL_MS);
    timer.unref();
    animation.timer = timer;
  }

  private async renderWorkingFrame(
    id: string,
    animation: WorkingAnimation,
  ): Promise<void> {
    animation.frame = (animation.frame + 1) % WORKING_FRAME_COUNT;
    try {
      await animation.actionInstance.setImage(
        agentImage(
          animation.slot,
          "working",
          animation.thread,
          animation.frame * WORKING_FRAME_DEGREES,
        ),
      );
    } catch (error) {
      if (this.workingAnimations.get(id) === animation) {
        this.workingAnimations.delete(id);
        logger.error(`Failed to animate task in slot ${animation.slot}`, error);
      }
    }
  }

  private async stopWorkingAnimation(id: string): Promise<void> {
    const animation = this.workingAnimations.get(id);
    if (!animation) return;

    this.workingAnimations.delete(id);
    if (animation.timer) clearTimeout(animation.timer);
    await animation.rendering;
  }
}
