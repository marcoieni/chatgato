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
const logger = streamDeck.logger.createScope("Agent Status");

@action({ UUID: "com.marco.chatgato.agent-status" })
export class AgentStatusAction extends SingletonAction<AgentSettings> {
  private readonly store = new CodexStore();
  private readonly poller = new ActionPoller();
  private readonly subscriptions = new Map<string, () => void>();
  private readonly visibleThreads = new Map<string, CodexThread>();

  override async onWillAppear(
    ev: WillAppearEvent<AgentSettings>,
  ): Promise<void> {
    this.subscribe(ev.action);
    await this.startPolling(ev.action, ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<AgentSettings>): void {
    this.poller.stop(ev.action.id);
    this.subscriptions.get(ev.action.id)?.();
    this.subscriptions.delete(ev.action.id);
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
      logger.error(`Failed to open chat in slot ${slot}`, error);
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
      pollIntervalMs(settings.pollSeconds, 5, 2, 60),
      () => actionInstance.showAlert(),
    );
  }

  private async refresh(
    actionInstance: VisibleAction,
    settings: AgentSettings,
  ): Promise<void> {
    const slot = this.slot(settings);
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

  private subscribe(actionInstance: VisibleAction): void {
    this.subscriptions.get(actionInstance.id)?.();
    const subscribe = (this.store as Partial<CodexStore>).subscribe;
    if (!subscribe) return;
    this.subscriptions.set(
      actionInstance.id,
      subscribe.call(this.store, () => {
        void actionInstance
          .getSettings<AgentSettings>()
          .then((settings) => this.refresh(actionInstance, settings))
          .catch(() => undefined);
      }),
    );
  }
}
