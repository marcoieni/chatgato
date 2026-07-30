import {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { normalizeAgentSlot } from "../lib/agent-slots.js";
import { ActionPoller, pollIntervalMs } from "../lib/action-poller.js";
import { CodexStore } from "../lib/codex-store.js";
import { buildThreadUrl } from "../lib/deep-links.js";
import { openThreadSlot, openUrl } from "../lib/codex-controller.js";
import { agentImage, effectiveStatus, keyTitle } from "../lib/visuals.js";
import type { AgentSettings, CodexThread } from "../types.js";

type VisibleAction = WillAppearEvent<AgentSettings>["action"];

@action({ UUID: "com.marco.chatgato.agent-status" })
export class AgentStatusAction extends SingletonAction<AgentSettings> {
  private readonly store = new CodexStore();
  private readonly poller = new ActionPoller();
  private readonly visibleThreads = new Map<string, CodexThread>();

  override async onWillAppear(
    ev: WillAppearEvent<AgentSettings>,
  ): Promise<void> {
    await this.startPolling(ev.action, ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<AgentSettings>): void {
    this.poller.stop(ev.action.id);
    this.visibleThreads.delete(ev.action.id);
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<AgentSettings>,
  ): Promise<void> {
    await this.startPolling(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<AgentSettings>): Promise<void> {
    try {
      const slot = this.slot(ev.payload.settings);
      const thread =
        this.visibleThreads.get(ev.action.id) ??
        (await this.store.threadAtSlot(slot, ev.payload.settings.cwdFilter));
      if (!thread) {
        await ev.action.showAlert();
        return;
      }

      if (thread.remoteHostId) {
        // Codex's own numbered chat command retains the SSH host associated
        // with the visible sidebar row. A codex://threads deep link does not:
        // the desktop deep-link handler only looks up the id on the local host.
        await openThreadSlot(slot);
      } else {
        await openUrl(buildThreadUrl(thread.id));
      }

      await ev.action.setSettings({
        ...ev.payload.settings,
        acknowledgedThreadId: thread.id,
        acknowledgedAtMs: Date.now(),
      });
    } catch {
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
    try {
      const thread = await this.store.threadAtSlot(slot, settings.cwdFilter);
      if (!thread) {
        this.visibleThreads.delete(actionInstance.id);
        await Promise.all([
          actionInstance.setImage(agentImage(slot, "off")),
          actionInstance.setTitle(`AGENT ${slot}\nEMPTY`),
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
        actionInstance.setImage(agentImage(slot, status)),
        actionInstance.setTitle(keyTitle(thread, status)),
      ]);
    } catch {
      this.visibleThreads.delete(actionInstance.id);
      await Promise.all([
        actionInstance.setImage(agentImage(slot, "error")),
        actionInstance.setTitle("CODEX\nOFFLINE"),
      ]);
    }
  }

  private slot(settings: AgentSettings): number {
    return normalizeAgentSlot(settings.slot);
  }
}
