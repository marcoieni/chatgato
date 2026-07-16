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
import { runSlash } from "../lib/codex-controller.js";
import { ActionPoller } from "../lib/action-poller.js";
import { CodexStore } from "../lib/codex-store.js";
import { fastModeImage } from "../lib/visuals.js";
import type { FastModeSettings } from "../types.js";

const logger = streamDeck.logger.createScope("Fast Mode");
const POLL_INTERVAL_MS = 1_000;
const CONFIRM_TIMEOUT_MS = 2_000;
const CONFIRM_INTERVAL_MS = 100;

type VisibleAction = WillAppearEvent<FastModeSettings>["action"];

@action({ UUID: "com.marco.chatgato.fast-mode" })
export class FastModeAction extends SingletonAction<FastModeSettings> {
  private readonly store = new CodexStore();
  private readonly poller = new ActionPoller();
  private toggling = false;

  override async onWillAppear(ev: WillAppearEvent<FastModeSettings>): Promise<void> {
    await this.startPolling(ev.action);
  }

  override onWillDisappear(ev: WillDisappearEvent<FastModeSettings>): void {
    this.poller.stop(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<FastModeSettings>): Promise<void> {
    await this.startPolling(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<FastModeSettings>): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;

    try {
      const previous = await this.store.fastModeEnabled();
      const expected = !previous;
      await runSlash("/fast");
      const enabled = await this.waitForState(expected);
      await this.render(ev.action, enabled);
      if (enabled !== expected) {
        throw new Error("Codex did not change its persisted fast-mode state");
      }
      logger.info(`${enabled ? "Enabled" : "Disabled"} fast mode`);
    } catch (error) {
      logger.error("Failed to toggle fast mode", error);
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
        logger.error("Failed to refresh fast mode", error);
      },
    );
  }

  private async refresh(actionInstance: VisibleAction): Promise<void> {
    await this.render(actionInstance, await this.store.fastModeEnabled());
  }

  private async waitForState(expected: boolean): Promise<boolean> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    let enabled = await this.store.fastModeEnabled();
    while (enabled !== expected && Date.now() < deadline) {
      await delay(CONFIRM_INTERVAL_MS);
      enabled = await this.store.fastModeEnabled();
    }
    return enabled;
  }

  private async render(
    actionInstance: WillAppearEvent<FastModeSettings>["action"],
    enabled: boolean,
  ): Promise<void> {
    await Promise.all([
      actionInstance.setImage(fastModeImage(enabled)),
      actionInstance.setTitle(enabled ? "FAST\nON" : "FAST\nOFF"),
    ]);
  }
}
