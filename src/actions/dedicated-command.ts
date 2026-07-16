import {
  action,
  SingletonAction,
  type KeyDownEvent,
} from "@elgato/streamdeck";
import streamDeck from "@elgato/streamdeck";
import { executeCommand } from "../lib/codex-controller.js";

type DedicatedCommandSettings = Record<string, never>;

export abstract class DedicatedCommandAction extends SingletonAction<DedicatedCommandSettings> {
  private readonly logger;

  protected constructor(
    private readonly command: string,
    label: string,
  ) {
    super();
    this.logger = streamDeck.logger.createScope(label);
  }

  override async onKeyDown(ev: KeyDownEvent<DedicatedCommandSettings>): Promise<void> {
    try {
      await executeCommand(this.command);
      this.logger.info(`Ran command '${this.command}'`);
    } catch (error) {
      this.logger.error(`Failed to run command '${this.command}'`, error);
      await ev.action.showAlert();
    }
  }
}

@action({ UUID: "com.marco.chatgato.submit" })
export class SubmitAction extends DedicatedCommandAction {
  constructor() {
    super("submit", "Submit");
  }
}

@action({ UUID: "com.marco.chatgato.fork" })
export class ForkAction extends DedicatedCommandAction {
  constructor() {
    super("forkThread", "Fork");
  }
}

@action({ UUID: "com.marco.chatgato.review-tab" })
export class ReviewTabAction extends DedicatedCommandAction {
  constructor() {
    super("review", "Review Tab");
  }
}

@action({ UUID: "com.marco.chatgato.toggle-terminal" })
export class ToggleTerminalAction extends DedicatedCommandAction {
  constructor() {
    super("terminal", "Toggle Terminal");
  }
}

@action({ UUID: "com.marco.chatgato.open-review" })
export class OpenReviewAction extends DedicatedCommandAction {
  constructor() {
    super("openReview", "Review");
  }
}

@action({ UUID: "com.marco.chatgato.settings" })
export class SettingsAction extends DedicatedCommandAction {
  constructor() {
    super("settings", "Settings");
  }
}

@action({ UUID: "com.marco.chatgato.plan" })
export class PlanAction extends DedicatedCommandAction {
  constructor() {
    super("togglePlan", "Plan");
  }
}

@action({ UUID: "com.marco.chatgato.skills" })
export class SkillsAction extends DedicatedCommandAction {
  constructor() {
    super("skills", "Skills");
  }
}

@action({ UUID: "com.marco.chatgato.scheduled" })
export class ScheduledAction extends DedicatedCommandAction {
  constructor() {
    super("scheduled", "Scheduled");
  }
}

@action({ UUID: "com.marco.chatgato.go-back" })
export class GoBackAction extends DedicatedCommandAction {
  constructor() {
    super("navigateBack", "Go Back");
  }
}

@action({ UUID: "com.marco.chatgato.go-forward" })
export class GoForwardAction extends DedicatedCommandAction {
  constructor() {
    super("navigateForward", "Go Forward");
  }
}

@action({ UUID: "com.marco.chatgato.toggle-sidebar" })
export class ToggleSidebarAction extends DedicatedCommandAction {
  constructor() {
    super("toggleSidebar", "Toggle Sidebar");
  }
}
