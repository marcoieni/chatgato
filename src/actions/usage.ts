import {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import { ActionPoller, pollIntervalMs } from "../lib/action-poller.js";
import { CodexStore } from "../lib/codex-store.js";
import { usageImage } from "../lib/visuals.js";
import type { UsageSettings } from "../types.js";

type VisibleAction = WillAppearEvent<UsageSettings>["action"];

@action({ UUID: "com.marco.chatgato.usage" })
export class UsageAction extends SingletonAction<UsageSettings> {
  private readonly store = new CodexStore();
  private readonly poller = new ActionPoller();

  override async onWillAppear(ev: WillAppearEvent<UsageSettings>): Promise<void> {
    await this.startPolling(ev.action, ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<UsageSettings>): void {
    this.poller.stop(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageSettings>): Promise<void> {
    await this.startPolling(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<UsageSettings>): Promise<void> {
    await this.refresh(ev.action);
  }

  private async startPolling(actionInstance: VisibleAction, settings: UsageSettings): Promise<void> {
    await this.poller.start(
      actionInstance.id,
      () => this.refresh(actionInstance),
      pollIntervalMs(settings.pollSeconds, 15, 5, 300),
    );
  }

  private async refresh(actionInstance: VisibleAction): Promise<void> {
    try {
      const usage = await this.store.latestUsage();
      await Promise.all([
        actionInstance.setImage(usageImage(usage)),
        actionInstance.setTitle(""),
      ]);
    } catch {
      await Promise.all([
        actionInstance.setImage(usageImage(null, true)),
        actionInstance.setTitle(""),
      ]);
    }
  }
}
