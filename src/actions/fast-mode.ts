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
import { CodexStore, type FastModeStates } from "../lib/codex-store.js";
import { fastModeImage } from "../lib/visuals.js";
import type { FastModeSettings } from "../types.js";

const logger = streamDeck.logger.createScope("Fast Mode");
const POLL_INTERVAL_MS = 5_000;
const CONFIRM_TIMEOUT_MS = 2_000;
const CONFIRM_INTERVAL_MS = 100;

type VisibleAction = WillAppearEvent<FastModeSettings>["action"];
type FastModeScope = "local" | "remote";

type FastModeChange = {
  enabled: boolean;
  scope: FastModeScope;
  states: FastModeStates;
};

@action({ UUID: "com.marco.chatgato.fast-mode" })
export class FastModeAction extends SingletonAction<FastModeSettings> {
  private readonly store = new CodexStore();
  private readonly poller = new ActionPoller();
  private readonly subscriptions = new Map<string, () => void>();
  private activeScope: FastModeScope | null = null;
  private lastStates: FastModeStates | null = null;
  private toggling = false;

  override async onWillAppear(
    ev: WillAppearEvent<FastModeSettings>,
  ): Promise<void> {
    this.subscribe(ev.action);
    await this.startPolling(ev.action);
  }

  override onWillDisappear(ev: WillDisappearEvent<FastModeSettings>): void {
    this.poller.stop(ev.action.id);
    this.subscriptions.get(ev.action.id)?.();
    this.subscriptions.delete(ev.action.id);
  }

  override async onDidReceiveSettings(
    ev: DidReceiveSettingsEvent<FastModeSettings>,
  ): Promise<void> {
    await this.startPolling(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<FastModeSettings>): Promise<void> {
    if (this.toggling) return;
    this.toggling = true;

    try {
      const previous = await this.store.fastModeStates(true);
      this.lastStates = previous;
      await executeCommand("toggleFast");
      const change = await this.waitForState(previous);
      if (!change) {
        throw new Error("Codex did not change its persisted fast-mode state");
      }
      this.activeScope = change.scope;
      this.lastStates = change.states;
      await this.render(ev.action, change.enabled);
      logger.info(`${change.enabled ? "Enabled" : "Disabled"} fast mode`);
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
    const states = await this.store.fastModeStates();
    if (this.lastStates) {
      this.activeScope =
        this.lastStates.selectionId !== states.selectionId
          ? selectedScope(states)
          : (changedScope(this.lastStates, states) ?? this.activeScope);
    }
    this.lastStates = states;
    await this.render(
      actionInstance,
      enabledForScope(states, this.activeScope),
    );
  }

  private subscribe(actionInstance: VisibleAction): void {
    this.subscriptions.get(actionInstance.id)?.();
    const subscribe = (this.store as Partial<CodexStore>).subscribe;
    if (!subscribe) return;
    this.subscriptions.set(
      actionInstance.id,
      subscribe.call(this.store, () => {
        void this.refresh(actionInstance).catch(() => undefined);
      }),
    );
  }

  private async waitForState(
    previous: FastModeStates,
  ): Promise<FastModeChange | null> {
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    let states = await this.store.fastModeStates(true);
    let scope = changedScope(previous, states);
    while (!scope && Date.now() < deadline) {
      await delay(CONFIRM_INTERVAL_MS);
      states = await this.store.fastModeStates(true);
      scope = changedScope(previous, states);
    }
    return scope
      ? { enabled: enabledForScope(states, scope), scope, states }
      : null;
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

function changedScope(
  previous: FastModeStates,
  current: FastModeStates,
): FastModeScope | null {
  if (current.localEnabled !== previous.localEnabled) return "local";
  if (
    previous.remoteEnabled !== null &&
    current.remoteEnabled !== null &&
    current.remoteEnabled !== previous.remoteEnabled
  ) {
    return "remote";
  }
  return null;
}

function enabledForScope(
  states: FastModeStates,
  scope: FastModeScope | null,
): boolean {
  if (scope === "local" || states.remoteEnabled === null) {
    return states.localEnabled;
  }
  return states.remoteEnabled;
}

function selectedScope(states: FastModeStates): FastModeScope {
  return states.remoteEnabled === null ? "local" : "remote";
}
