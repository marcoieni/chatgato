import { action, SingletonAction, type KeyDownEvent } from "@elgato/streamdeck";
import { openAndMaybeSubmit } from "../lib/codex-controller.js";
import { buildNewTaskUrl } from "../lib/deep-links.js";
import type { NewTaskSettings } from "../types.js";

@action({ UUID: "com.marco.chatgato.new-task" })
export class NewTaskAction extends SingletonAction<NewTaskSettings> {
  override async onKeyDown(ev: KeyDownEvent<NewTaskSettings>): Promise<void> {
    try {
      await openAndMaybeSubmit(
        buildNewTaskUrl(ev.payload.settings),
        ev.payload.settings.autoSubmit,
        ev.payload.settings.submitDelayMs,
      );
    } catch {
      await ev.action.showAlert();
    }
  }
}
