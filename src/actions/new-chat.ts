import { action, SingletonAction, type KeyDownEvent } from "@elgato/streamdeck";
import { openAndMaybeSubmit } from "../lib/codex-controller.js";
import { buildNewChatUrl } from "../lib/deep-links.js";
import type { NewChatSettings } from "../types.js";

@action({ UUID: "com.marco.chatgato.new-chat" })
export class NewChatAction extends SingletonAction<NewChatSettings> {
  override async onKeyDown(ev: KeyDownEvent<NewChatSettings>): Promise<void> {
    try {
      await openAndMaybeSubmit(
        buildNewChatUrl(ev.payload.settings),
        ev.payload.settings.autoSubmit,
        ev.payload.settings.submitDelayMs,
      );
    } catch {
      await ev.action.showAlert();
    }
  }
}
