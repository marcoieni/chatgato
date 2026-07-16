import {
  action,
  SingletonAction,
  type KeyDownEvent,
  type KeyUpEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { executeCommand } from "../lib/codex-controller.js";
import {
  PushToTalkSession,
  pushToTalkSession,
} from "../lib/push-to-talk-session.js";
import type { CommandSettings } from "../types.js";

const logger = streamDeck.logger.createScope("Codex Command");

@action({ UUID: "com.marco.chatgato.command" })
export class CommandAction extends SingletonAction<CommandSettings> {
  constructor(private readonly pushToTalk: PushToTalkSession = pushToTalkSession) {
    super();
  }

  private legacyPushToTalkId(id: string): string {
    return `legacy-command:${id}`;
  }

  override async onKeyDown(ev: KeyDownEvent<CommandSettings>): Promise<void> {
    const command = ev.payload.settings.command ?? "environmentAction";
    // Push to talk is no longer offered here, but saved Command keys keep working.
    if (command === "ptt") {
      try {
        if (await this.pushToTalk.press(this.legacyPushToTalkId(ev.action.id))) {
          logger.info("Started push-to-talk from a legacy Command key");
        }
      } catch (error) {
        logger.error("Failed to start push-to-talk from a legacy Command key", error);
        await ev.action.showAlert();
      }
      return;
    }

    try {
      await executeCommand(command, ev.payload.settings.paletteQuery);
      logger.info(`Ran command '${command}'`);
    } catch (error) {
      logger.error(`Failed to run command '${command}'`, error);
      await ev.action.showAlert();
    }
  }

  override async onKeyUp(ev: KeyUpEvent<CommandSettings>): Promise<void> {
    try {
      if (await this.pushToTalk.release(this.legacyPushToTalkId(ev.action.id))) {
        logger.info("Stopped push-to-talk from a legacy Command key");
      }
    } catch (error) {
      logger.error("Failed to stop push-to-talk from a legacy Command key", error);
      await ev.action.showAlert();
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent<CommandSettings>): Promise<void> {
    try {
      if (await this.pushToTalk.release(this.legacyPushToTalkId(ev.action.id))) {
        logger.info("Released a legacy push-to-talk Command key while it disappeared");
      }
    } catch (error) {
      logger.error("Failed to release a disappearing legacy push-to-talk Command key", error);
    }
  }
}
