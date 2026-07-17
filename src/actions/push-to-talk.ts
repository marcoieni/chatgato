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

const logger = streamDeck.logger.createScope("Push to Talk");

@action({ UUID: "com.marco.chatgato.push-to-talk" })
export class PushToTalkAction extends SingletonAction<PushToTalkSettings> {
  constructor(private readonly session: PushToTalkSession = pushToTalkSession) {
    super();
  }

  private actionId(id: string): string {
    return `push-to-talk:${id}`;
  }

  override async onWillAppear(
    ev: WillAppearEvent<PushToTalkSettings>,
  ): Promise<void> {
    await this.render(ev.action, false);
  }

  override async onKeyDown(
    ev: KeyDownEvent<PushToTalkSettings>,
  ): Promise<void> {
    try {
      if (await this.session.press(this.actionId(ev.action.id))) {
        logger.info("Started push-to-talk");
      }
    } catch (error) {
      logger.error("Failed to start push-to-talk", error);
      await this.render(ev.action, false);
      await ev.action.showAlert();
      return;
    }

    await this.render(ev.action, true);
  }

  override async onKeyUp(ev: KeyUpEvent<PushToTalkSettings>): Promise<void> {
    try {
      if (await this.session.release(this.actionId(ev.action.id))) {
        logger.info("Stopped push-to-talk");
      }
    } catch (error) {
      logger.error("Failed to stop push-to-talk", error);
      await ev.action.showAlert();
    } finally {
      await this.render(ev.action, false);
    }
  }

  override async onWillDisappear(
    ev: WillDisappearEvent<PushToTalkSettings>,
  ): Promise<void> {
    try {
      if (await this.session.release(this.actionId(ev.action.id))) {
        logger.info("Released push-to-talk while action disappeared");
      }
    } catch (error) {
      logger.error(
        "Failed to release push-to-talk while action disappeared",
        error,
      );
    }
  }

  private async render(
    actionInstance: WillAppearEvent<PushToTalkSettings>["action"],
    active: boolean,
  ): Promise<void> {
    await actionInstance.setImage(pushToTalkImage(active));
  }
}
