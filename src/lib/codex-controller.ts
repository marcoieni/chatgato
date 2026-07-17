import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CodexStore, type ReasoningDirection } from "./codex-store.js";
import { ReasoningTracker } from "./reasoning-tracker.js";

export type CodexMode = "fast" | "plan";

export type ControllerCommand = {
  kind: "url" | "shortcut" | "slash";
  value: string;
};

export const COMMANDS: Record<string, ControllerCommand> = {
  approve: { kind: "shortcut", value: "approve" },
  decline: { kind: "shortcut", value: "decline" },
  forkThread: { kind: "slash", value: "/fork" },
  submit: { kind: "shortcut", value: "submit" },
  terminal: { kind: "shortcut", value: "terminal" },
  review: { kind: "shortcut", value: "review" },
  openReview: { kind: "slash", value: "/review" },
  settings: { kind: "url", value: "codex://settings" },
  scheduled: { kind: "url", value: "codex://automations" },
  skills: { kind: "url", value: "codex://skills" },
  togglePlan: { kind: "slash", value: "/plan" },
  navigateBack: { kind: "shortcut", value: "navigateBack" },
  navigateForward: { kind: "shortcut", value: "navigateForward" },
  toggleSidebar: { kind: "shortcut", value: "toggleSidebar" },
};

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const appleScript = join(pluginDir, "scripts", "codex-control.applescript");
const powerShellScript = join(pluginDir, "scripts", "codex-control.ps1");
const reasoningTracker = new ReasoningTracker();
// Stream Deck can deliver adjacent key/dial events before the first automation finishes.
let reasoningQueue: Promise<unknown> = Promise.resolve();

function run(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-4000);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else {
        const detail = stderr.trim();
        reject(
          new Error(
            `${executable} exited with code ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`,
          ),
        );
      }
    });
  });
}

async function runControlScript(
  mode: "shortcut" | "slash" | "reasoning" | "mode",
  payload: string,
  capability: string,
): Promise<string> {
  if (process.platform === "darwin") {
    return run("/usr/bin/osascript", [appleScript, mode, payload]);
  }
  if (process.platform === "win32") {
    return run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      powerShellScript,
      mode,
      payload,
    ]);
  }
  throw new Error(`Codex ${capability} is supported on macOS and Windows`);
}

export async function openUrl(url: string): Promise<void> {
  if (!/^(codex|https):\/\//.test(url))
    throw new Error("Unsupported URL scheme");
  if (process.platform === "darwin") {
    await run("/usr/bin/open", [url]);
    return;
  }
  if (process.platform === "win32") {
    await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      powerShellScript,
      "url",
      url,
    ]);
    return;
  }
  await run("xdg-open", [url]);
}

export async function runShortcut(shortcut: string): Promise<void> {
  await runControlScript("shortcut", shortcut, "keyboard control");
}

export function pushToTalkPayload(
  active: boolean,
): "dictationDown" | "dictationUp" {
  return active ? "dictationDown" : "dictationUp";
}

export async function setPushToTalk(active: boolean): Promise<void> {
  await runShortcut(pushToTalkPayload(active));
}

export function normalizeSlashCommand(command: string): string {
  const clean = command.trim();
  if (!/^\/[a-z][a-z-]*$/u.test(clean)) {
    throw new Error("Invalid Codex slash command");
  }
  return clean;
}

export async function runSlash(command: string): Promise<void> {
  const clean = normalizeSlashCommand(command);
  await runControlScript("slash", clean, "slash-command control");
}

export function modePayload(
  mode: CodexMode,
  enabled: boolean,
): `${CodexMode}${"On" | "Off"}` {
  if (mode !== "fast" && mode !== "plan") {
    throw new Error("Invalid Codex mode");
  }
  return `${mode}${enabled ? "On" : "Off"}`;
}

export async function setMode(
  mode: CodexMode,
  enabled: boolean,
): Promise<void> {
  await runControlScript("mode", modePayload(mode, enabled), "mode control");
}

export async function togglePlanMode(): Promise<boolean> {
  if (process.platform === "darwin") {
    const state = await runControlScript(
      "mode",
      "planToggle",
      "Plan-mode control",
    );
    if (state === "on") return true;
    if (state === "off") return false;
    throw new Error(`Unexpected Codex Plan-mode state: ${state || "empty"}`);
  }
  const fallbackTarget = !(await new CodexStore().planModeEnabled());
  await setMode("plan", fallbackTarget);
  return fallbackTarget;
}

export async function runReasoning(
  direction: ReasoningDirection,
  steps = 1,
): Promise<boolean> {
  const pending = reasoningQueue.then(() => runReasoningNow(direction, steps));
  reasoningQueue = pending.catch(() => undefined);
  return pending;
}

async function runReasoningNow(
  direction: ReasoningDirection,
  steps: number,
): Promise<boolean> {
  const snapshot = await new CodexStore().reasoningSnapshot();
  const target = reasoningTracker.plan(snapshot, direction, steps);
  if (!target.changed) return false;
  const optionIndex = String(target.optionIndex);
  await runControlScript("reasoning", optionIndex, "reasoning control");
  reasoningTracker.commit(target);
  return true;
}

export async function executeCommand(commandId: string): Promise<void> {
  const command = COMMANDS[commandId];
  if (!command) throw new Error(`Unknown Codex command: ${commandId}`);
  if (command.kind === "url") return openUrl(command.value);
  if (command.kind === "shortcut") return runShortcut(command.value);
  return runSlash(command.value);
}

export async function openAndMaybeSubmit(
  url: string,
  autoSubmit: boolean | undefined,
  submitDelayMs = 900,
): Promise<void> {
  await openUrl(url);
  if (!autoSubmit) return;
  await delay(Math.min(5000, Math.max(300, submitDelayMs)));
  await runShortcut("submit");
}
