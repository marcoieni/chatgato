import {
  action,
  SingletonAction,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import { runReasoning } from "../lib/codex-controller.js";
import { reasoningSvg } from "../lib/visuals.js";
import type { ReasoningDirection } from "../lib/codex-store.js";
import type { ReasoningSettings } from "../types.js";

type ReasoningKeySettings = Record<string, never>;

abstract class ReasoningKeyAction extends SingletonAction<ReasoningKeySettings> {
  protected constructor(private readonly direction: ReasoningDirection) {
    super();
  }

  override async onWillAppear(ev: WillAppearEvent<ReasoningKeySettings>): Promise<void> {
    await Promise.all([
      ev.action.setImage(reasoningSvg(this.direction)),
      ev.action.setTitle(this.direction === "increase" ? "THINK\nMORE" : "THINK\nLESS"),
    ]);
  }

  override async onKeyDown(ev: KeyDownEvent<ReasoningKeySettings>): Promise<void> {
    try {
      await runReasoning(this.direction);
    } catch {
      await ev.action.showAlert();
    }
  }
}

@action({ UUID: "com.marco.chatgato.decrease-reasoning" })
export class DecreaseReasoningAction extends ReasoningKeyAction {
  constructor() {
    super("decrease");
  }
}

@action({ UUID: "com.marco.chatgato.increase-reasoning" })
export class IncreaseReasoningAction extends ReasoningKeyAction {
  constructor() {
    super("increase");
  }
}

type DialAccumulator = {
  ticks: number;
  timer: NodeJS.Timeout;
  action: DialRotateEvent<ReasoningSettings>["action"];
  settings: ReasoningSettings;
};

@action({ UUID: "com.marco.chatgato.reasoning" })
export class ReasoningAction extends SingletonAction<ReasoningSettings> {
  private readonly accumulators = new Map<string, DialAccumulator>();

  override async onWillAppear(ev: WillAppearEvent<ReasoningSettings>): Promise<void> {
    await this.render(ev.action, ev.payload.settings);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ReasoningSettings>): Promise<void> {
    await this.render(ev.action, ev.payload.settings);
  }

  override async onDialRotate(ev: DialRotateEvent<ReasoningSettings>): Promise<void> {
    const current = this.accumulators.get(ev.action.id);
    if (current) clearTimeout(current.timer);
    const ticks = (current?.ticks ?? 0) + ev.payload.ticks;
    const timer = setTimeout(() => void this.flush(ev.action.id), 180);
    this.accumulators.set(ev.action.id, {
      ticks,
      timer,
      action: ev.action,
      settings: ev.payload.settings,
    });

    await ev.action.setFeedback({
      title: "Reasoning",
      value: ticks > 0 ? "Increase" : "Decrease",
      indicator: Math.min(100, 50 + ticks * 10),
    });
  }

  private async flush(id: string): Promise<void> {
    const pending = this.accumulators.get(id);
    if (!pending) return;
    this.accumulators.delete(id);
    const limit = Math.min(5, Math.max(1, Number(pending.settings.maxStepsPerGesture) || 3));
    const steps = Math.min(limit, Math.max(1, Math.abs(pending.ticks)));
    const direction = pending.ticks > 0 ? "increase" : "decrease";
    try {
      const changed = await this.adjust(direction, pending.settings, steps);
      await pending.action.setFeedback({
        title: "Reasoning",
        value: changed
          ? direction === "increase"
            ? "Raised"
            : "Lowered"
          : direction === "increase"
            ? "Maximum"
            : "Minimum",
        indicator: direction === "increase" ? 75 : 25,
      });
    } catch {
      await pending.action.showAlert();
    }
  }

  private async adjust(
    direction: "increase" | "decrease",
    _settings: ReasoningSettings,
    steps = 1,
  ): Promise<boolean> {
    return runReasoning(direction, steps);
  }

  private async render(
    actionInstance: WillAppearEvent<ReasoningSettings>["action"],
    _settings: ReasoningSettings,
  ): Promise<void> {
    if (!actionInstance.isKey()) {
      await actionInstance.setFeedback({
        title: "Reasoning",
        value: "Turn to adjust",
        indicator: 50,
      });
    }
  }
}
