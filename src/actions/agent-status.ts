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
import { ActionSubscriptionRegistry } from "../lib/action-subscriptions.js";
import { CodexStore } from "../lib/codex-store.js";
import { T3Store, t3SourceKey } from "../lib/t3-store.js";
import { buildThreadUrl } from "../lib/deep-links.js";
import {
  openT3Code,
  openThreadBySearch,
  openUrl,
} from "../lib/codex-controller.js";
import { agentImage, effectiveStatus } from "../lib/visuals.js";
import type { AgentSettings, CodexThread } from "../types.js";

type VisibleAction = WillAppearEvent<AgentSettings>["action"];
const logger = streamDeck.logger.createScope("Agent Status");

@action({ UUID: "com.marco.chatgato.agent-status" })
export class AgentStatusAction extends SingletonAction<AgentSettings> {
  private readonly store = new CodexStore();
  private readonly t3Store = new T3Store();
  private readonly poller = new ActionPoller();
  private readonly subscriptions = new ActionSubscriptionRegistry();
  private readonly visibleThreads = new Map<
    string,
    { key: string; thread: CodexThread }
  >();
  private readonly refreshVersions = new Map<string, symbol>();

  override async onWillAppear(
    ev: WillAppearEvent<AgentSettings>,
  ): Promise<void> {
    await this.startPolling(ev.action, ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<AgentSettings>): void {
    this.poller.stop(ev.action.id);
    this.subscriptions.remove(ev.action.id);
    this.visibleThreads.delete(ev.action.id);
    this.refreshVersions.delete(ev.action.id);
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<AgentSettings>,
  ): Promise<void> {
    await this.startPolling(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<AgentSettings>): Promise<void> {
    const slot = this.slot(ev.payload.settings);
    try {
      const visible = this.visibleThreads.get(ev.action.id);
      const thread =
        visible?.key === this.selectionKey(ev.payload.settings)
          ? visible.thread
          : await this.threadAtSlot(ev.payload.settings);
      if (!thread) {
        await ev.action.showAlert();
        return;
      }

      if (ev.payload.settings.source === "t3-code") {
        await openT3Code();
      } else if (thread.remoteHostId) {
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
    this.subscriptions.remove(actionInstance.id);
    if (settings.source !== "t3-code") this.subscribe(actionInstance);
    this.visibleThreads.delete(actionInstance.id);
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
    const version = Symbol();
    this.refreshVersions.set(actionInstance.id, version);
    try {
      const thread = await this.threadAtSlot(settings);
      if (this.refreshVersions.get(actionInstance.id) !== version) return;
      if (!thread) {
        this.visibleThreads.delete(actionInstance.id);
        await Promise.all([
          actionInstance.setImage(
            agentImage(slot, "off", undefined, settings.source),
          ),
          actionInstance.setTitle(""),
        ]);
        return;
      }

      this.visibleThreads.set(actionInstance.id, {
        key: this.selectionKey(settings),
        thread,
      });
      const status = effectiveStatus(
        thread,
        settings.acknowledgedThreadId,
        settings.acknowledgedAtMs,
      );
      await Promise.all([
        actionInstance.setImage(agentImage(slot, status, thread)),
        actionInstance.setTitle(""),
      ]);
    } catch (error) {
      if (this.refreshVersions.get(actionInstance.id) !== version) return;
      logger.error(
        `Failed to read ${settings.source === "t3-code" ? "T3 Code" : "Codex"} chat status`,
        error,
      );
      this.visibleThreads.delete(actionInstance.id);
      await Promise.all([
        actionInstance.setImage(
          agentImage(slot, "error", undefined, settings.source),
        ),
        actionInstance.setTitle(""),
      ]);
    }
  }

  private slot(settings: AgentSettings): number {
    return normalizeAgentSlot(settings.slot);
  }

  private selectionKey(settings: AgentSettings): string {
    return JSON.stringify([
      settings.source ?? "codex",
      this.slot(settings),
      settings.source === "t3-code"
        ? t3SourceKey(settings)
        : (settings.cwdFilter ?? ""),
    ]);
  }

  private threadAtSlot(settings: AgentSettings): Promise<CodexThread | null> {
    return settings.source === "t3-code"
      ? this.t3Store.threadAtSlot(this.slot(settings), settings)
      : this.store.threadAtSlot(this.slot(settings), settings.cwdFilter);
  }

  private subscribe(actionInstance: VisibleAction): void {
    this.subscriptions.replace<void>(
      actionInstance.id,
      (listener) => this.store.subscribe(() => listener()),
      async () => {
        const settings = await actionInstance.getSettings<AgentSettings>();
        await this.refresh(actionInstance, settings);
      },
    );
  }
}
