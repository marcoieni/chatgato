import streamDeck from "@elgato/streamdeck";
import { AgentStatusAction } from "./actions/agent-status.js";
import { ApproveAction } from "./actions/approve.js";
import { CommandAction } from "./actions/command.js";
import { DeclineAction } from "./actions/decline.js";
import {
  ForkAction,
  GoBackAction,
  GoForwardAction,
  OpenReviewAction,
  PlanAction,
  ReviewTabAction,
  ScheduledAction,
  SettingsAction,
  SkillsAction,
  SubmitAction,
  ToggleSidebarAction,
  ToggleTerminalAction,
} from "./actions/dedicated-command.js";
import { FastModeAction } from "./actions/fast-mode.js";
import { NewTaskAction } from "./actions/new-task.js";
import { PushToTalkAction } from "./actions/push-to-talk.js";
import { ReasoningAction } from "./actions/reasoning.js";
import { TapToTalkAction } from "./actions/tap-to-talk.js";
import { UsageAction } from "./actions/usage.js";
import { WorkflowAction } from "./actions/workflow.js";

streamDeck.logger.setLevel("info");
streamDeck.actions.registerAction(new AgentStatusAction());
streamDeck.actions.registerAction(new NewTaskAction());
streamDeck.actions.registerAction(new WorkflowAction());
streamDeck.actions.registerAction(new FastModeAction());
streamDeck.actions.registerAction(new PushToTalkAction());
streamDeck.actions.registerAction(new TapToTalkAction());
streamDeck.actions.registerAction(new ApproveAction());
streamDeck.actions.registerAction(new DeclineAction());
streamDeck.actions.registerAction(new SubmitAction());
streamDeck.actions.registerAction(new ForkAction());
streamDeck.actions.registerAction(new ReviewTabAction());
streamDeck.actions.registerAction(new ToggleTerminalAction());
streamDeck.actions.registerAction(new OpenReviewAction());
streamDeck.actions.registerAction(new SettingsAction());
streamDeck.actions.registerAction(new PlanAction());
streamDeck.actions.registerAction(new SkillsAction());
streamDeck.actions.registerAction(new ScheduledAction());
streamDeck.actions.registerAction(new GoBackAction());
streamDeck.actions.registerAction(new GoForwardAction());
streamDeck.actions.registerAction(new ToggleSidebarAction());
streamDeck.actions.registerAction(new CommandAction());
streamDeck.actions.registerAction(new ReasoningAction());
streamDeck.actions.registerAction(new UsageAction());

streamDeck.connect();
