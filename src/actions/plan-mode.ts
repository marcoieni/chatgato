import {
  action,
  SingletonAction,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { setTimeout as delay } from "node:timers/promises";
import { executeCommand } from "../lib/codex-controller.js";
import { ActionPoller } from "../lib/action-poller.js";
import { CodexStore } from "../lib/codex-store.js";
import { planModeImage } from "../lib/visuals.js";
import type { PlanModeSettings } from "../types.js";

const logger = streamDeck.logger.createScope("Plan Mode");
const POLL_INTERVAL_MS = 1_000;
const CONFIRM_TIMEOUT_MS = 2_000;
const CONFIRM_INTERVAL_MS = 100;

type VisibleAction = WillAppearEvent<PlanModeSettings>["action"];

@action({ UUID: "com.marco.chatgato.plan" })
export class PlanModeAction extends SingletonAction<PlanModeSettings> {
  private readonly store = new CodexStore();
  private readonly poller = new ActionPoller();
  private toggling = false;

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
      const previous = await this.store.planModeEnabled();
      const expected = !previous;
      await executeCommand("togglePlan");
      const enabled = await this.waitForState(expected);
      await this.render(ev.action, enabled);
      if (enabled !== expected) {
        throw new Error("Codex did not change its persisted plan-mode state");
      }
      logger.info(`${enabled ? "Enabled" : "Disabled"} plan mode`);
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
    await this.render(actionInstance, await this.store.planModeEnabled());
  }

  private async waitForState(expected: boolean): Promise<boolean> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    let enabled = await this.store.planModeEnabled();
    while (enabled !== expected && Date.now() < deadline) {
      await delay(CONFIRM_INTERVAL_MS);
      enabled = await this.store.planModeEnabled();
    }
    return enabled;
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
