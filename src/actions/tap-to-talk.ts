import {
  action,
  SingletonAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import {
  PushToTalkSession,
  pushToTalkSession,
} from "../lib/push-to-talk-session.js";
import { pushToTalkImage } from "../lib/visuals.js";
import type { PushToTalkSettings } from "../types.js";

const logger = streamDeck.logger.createScope("Tap to Talk");

@action({ UUID: "com.marco.chatgato.tap-to-talk" })
export class TapToTalkAction extends SingletonAction<PushToTalkSettings> {
  private readonly activeActions = new Set<string>();
  private readonly pressedActions = new Set<string>();
  private readonly togglingActions = new Set<string>();

  constructor(private readonly session: PushToTalkSession = pushToTalkSession) {
    super();
  }

  private actionId(id: string): string {
    return `tap-to-talk:${id}`;
  }

  override async onWillAppear(
    ev: WillAppearEvent<PushToTalkSettings>,
  ): Promise<void> {
    await this.render(
      ev.action,
      this.activeActions.has(this.actionId(ev.action.id)),
    );
  }

  override async onKeyDown(
    ev: KeyDownEvent<PushToTalkSettings>,
  ): Promise<void> {
    const actionId = this.actionId(ev.action.id);
    if (this.pressedActions.has(actionId)) return;
    this.pressedActions.add(actionId);

    if (this.togglingActions.has(actionId)) return;
    this.togglingActions.add(actionId);

    try {
      if (this.activeActions.has(actionId)) {
        this.activeActions.delete(actionId);
        if (await this.session.release(actionId)) {
          logger.info("Stopped tap-to-talk");
        }
        await this.render(ev.action, false);
        return;
      }

      this.activeActions.add(actionId);
      if (await this.session.press(actionId)) {
        logger.info("Started tap-to-talk");
      }
      if (this.activeActions.has(actionId)) {
        await this.render(ev.action, true);
      }
    } catch (error) {
      this.activeActions.delete(actionId);
      logger.error("Failed to toggle tap-to-talk", error);
      await this.render(ev.action, false);
      await ev.action.showAlert();
    } finally {
      this.togglingActions.delete(actionId);
    }
  }

  override onKeyUp(ev: KeyUpEvent<PushToTalkSettings>): void {
    this.pressedActions.delete(this.actionId(ev.action.id));
  }

  override async onWillDisappear(
    ev: WillDisappearEvent<PushToTalkSettings>,
  ): Promise<void> {
    const actionId = this.actionId(ev.action.id);
    this.pressedActions.delete(actionId);
    if (!this.activeActions.delete(actionId)) return;

    try {
      if (await this.session.release(actionId)) {
        logger.info("Stopped tap-to-talk while action disappeared");
      }
    } catch (error) {
      logger.error("Failed to stop disappearing tap-to-talk action", error);
    }
  }

  private async render(
    actionInstance: WillAppearEvent<PushToTalkSettings>["action"],
    active: boolean,
  ): Promise<void> {
    await Promise.all([
      actionInstance.setImage(pushToTalkImage(active)),
      actionInstance.setTitle(active ? "TAP\nTO STOP" : "TAP\nTO TALK"),
    ]);
  }
}
