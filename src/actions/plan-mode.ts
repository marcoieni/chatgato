import {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { executeCommand } from "../lib/codex-controller.js";
import { ActionPoller } from "../lib/action-poller.js";
import { CodexStore } from "../lib/codex-store.js";
import { planModeImage } from "../lib/visuals.js";
import type { PlanModeSettings } from "../types.js";

const logger = streamDeck.logger.createScope("Plan Mode");
const POLL_INTERVAL_MS = 1_000;

type VisibleAction = WillAppearEvent<PlanModeSettings>["action"];

@action({ UUID: "com.marco.chatgato.plan" })
export class PlanModeAction extends SingletonAction<PlanModeSettings> {
  private readonly store = new CodexStore();
  private readonly poller = new ActionPoller();
  private toggling = false;
  private optimisticEnabled: boolean | null = null;

  override async onWillAppear(
    ev: WillAppearEvent<PlanModeSettings>,
  ): Promise<void> {
    await this.startPolling(ev.action);
  }

  override onWillDisappear(ev: WillDisappearEvent<PlanModeSettings>): void {
    this.poller.stop(ev.action.id);
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<PlanModeSettings>,
  ): Promise<void> {
    await this.startPolling(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<PlanModeSettings>): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;

    try {
      const previous =
        this.optimisticEnabled ?? (await this.store.planModeEnabled());
      const expected = !previous;
      await executeCommand("togglePlan");
      // Codex applies this setting in memory for the next turn, but may not
      // append it to the rollout until that turn starts. Keep the key in sync
      // with the command we just sent while the persisted state catches up.
      this.optimisticEnabled = expected;
      await this.render(ev.action, expected);
      logger.info(`${expected ? "Enabled" : "Disabled"} plan mode`);
    } catch (error) {
      logger.error("Failed to toggle plan mode", error);
      await this.refresh(ev.action).catch(() => undefined);
      await ev.action.showAlert();
    } finally {
      this.toggling = false;
    }
  }

  private async startPolling(actionInstance: VisibleAction): Promise<void> {
    await this.poller.start(
      actionInstance.id,
      () => this.refresh(actionInstance),
      POLL_INTERVAL_MS,
      (error) => {
        logger.error("Failed to refresh plan mode", error);
      },
    );
  }

  private async refresh(actionInstance: VisibleAction): Promise<void> {
    const persistedEnabled = await this.store.planModeEnabled();
    if (
      this.optimisticEnabled !== null &&
      persistedEnabled === this.optimisticEnabled
    ) {
      this.optimisticEnabled = null;
    }
    await this.render(
      actionInstance,
      this.optimisticEnabled ?? persistedEnabled,
    );
  }

  private async render(
    actionInstance: VisibleAction,
    enabled: boolean,
  ): Promise<void> {
    await Promise.all([
      actionInstance.setImage(planModeImage(enabled)),
      actionInstance.setTitle(enabled ? "PLAN\nON" : "PLAN\nOFF"),
    ]);
  }
}
