import { action, SingletonAction, type KeyDownEvent } from "@elgato/streamdeck";
import { openAndMaybeSubmit } from "../lib/codex-controller.js";
import { buildRunPrompt, buildRunPromptUrl } from "../lib/deep-links.js";
import type { RunPromptSettings } from "../types.js";

@action({ UUID: "com.marco.chatgato.workflow" })
export class RunPromptAction extends SingletonAction<RunPromptSettings> {
  override async onKeyDown(ev: KeyDownEvent<RunPromptSettings>): Promise<void> {
    if (!buildRunPrompt(ev.payload.settings)) {
      await ev.action.showAlert();
      return;
    }
    try {
      await openAndMaybeSubmit(
        buildRunPromptUrl(ev.payload.settings),
        ev.payload.settings.autoSubmit,
        ev.payload.settings.submitDelayMs,
      );
    } catch {
      await ev.action.showAlert();
    }
  }
}
