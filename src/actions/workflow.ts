import { action, SingletonAction, type KeyDownEvent } from "@elgato/streamdeck";
import { openAndMaybeSubmit } from "../lib/codex-controller.js";
import { buildWorkflowPrompt, buildWorkflowUrl } from "../lib/deep-links.js";
import type { WorkflowSettings } from "../types.js";

@action({ UUID: "com.marco.chatgato.workflow" })
export class WorkflowAction extends SingletonAction<WorkflowSettings> {
  override async onKeyDown(ev: KeyDownEvent<WorkflowSettings>): Promise<void> {
    if (!buildWorkflowPrompt(ev.payload.settings)) {
      await ev.action.showAlert();
      return;
    }
    try {
      await openAndMaybeSubmit(
        buildWorkflowUrl(ev.payload.settings),
        ev.payload.settings.autoSubmit,
        ev.payload.settings.submitDelayMs,
      );
    } catch {
      await ev.action.showAlert();
    }
  }
}
