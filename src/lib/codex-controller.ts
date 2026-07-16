import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CodexStore, type ReasoningDirection } from "./codex-store.js";
import { ReasoningTracker } from "./reasoning-tracker.js";

export type ControllerCommand = {
  kind: "url" | "shortcut" | "palette" | "slash" | "reasoning";
  value: string;
};

export const COMMANDS: Record<string, ControllerCommand> = {
  // Some commands are kept here for existing Command keys even though dedicated actions now own
  // their UI. The dedicated actions also share this dispatch path so behavior stays consistent.
  fast: { kind: "slash", value: "/fast" },
  approve: { kind: "shortcut", value: "approve" },
  decline: { kind: "shortcut", value: "decline" },
  forkThread: { kind: "slash", value: "/fork" },
  submit: { kind: "shortcut", value: "submit" },
  feedback: { kind: "palette", value: "Feedback" },
  docs: { kind: "url", value: "https://developers.openai.com" },
  terminal: { kind: "shortcut", value: "terminal" },
  copyMarkdown: { kind: "palette", value: "Copy conversation as Markdown" },
  archiveThread: { kind: "shortcut", value: "archiveThread" },
  newTask: { kind: "url", value: "codex://threads/new" },
  searchTasks: { kind: "shortcut", value: "searchTasks" },
  previousTask: { kind: "shortcut", value: "previousTask" },
  nextTask: { kind: "shortcut", value: "nextTask" },
  openBrowser: { kind: "shortcut", value: "openBrowser" },
  togglePin: { kind: "shortcut", value: "togglePin" },
  review: { kind: "shortcut", value: "review" },
  openReview: { kind: "slash", value: "/review" },
  environmentAction: { kind: "shortcut", value: "environmentAction" },
  commit: { kind: "palette", value: "Commit or push" },
  pullRequest: { kind: "palette", value: "Create PR" },
  addPhotos: { kind: "palette", value: "Add photos" },
  settings: { kind: "url", value: "codex://settings" },
  sideChat: { kind: "shortcut", value: "sideChat" },
  scheduled: { kind: "url", value: "codex://automations" },
  reasoningUp: { kind: "reasoning", value: "increase" },
  reasoningDown: { kind: "reasoning", value: "decrease" },
  openFolder: { kind: "shortcut", value: "openFolder" },
  addFiles: { kind: "palette", value: "Add files" },
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

function run(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
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
  mode: "shortcut" | "palette" | "slash" | "reasoning",
  payload: string,
  capability: string,
): Promise<void> {
  if (process.platform === "darwin") {
    await run("/usr/bin/osascript", [appleScript, mode, payload]);
    return;
  }
  if (process.platform === "win32") {
    await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      powerShellScript,
      mode,
      payload,
    ]);
    return;
  }
  throw new Error(`Codex ${capability} is supported on macOS and Windows`);
}

export async function openUrl(url: string): Promise<void> {
  if (!/^(codex|https):\/\//.test(url)) throw new Error("Unsupported URL scheme");
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

export function pushToTalkPayload(active: boolean): "dictationDown" | "dictationUp" {
  return active ? "dictationDown" : "dictationUp";
}

export async function setPushToTalk(active: boolean): Promise<void> {
  await runShortcut(pushToTalkPayload(active));
}

export function normalizePaletteQuery(
  query: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const clean = query.trim();
  if (!clean) throw new Error("Command Menu query is empty");
  if (/[\u0000-\u001f\u007f]/u.test(clean)) {
    throw new Error("Command Menu query contains control characters");
  }
  if (platform === "win32" && /[{}]/u.test(clean)) {
    throw new Error("Command Menu query contains unsupported SendKeys characters");
  }
  return clean;
}

export function normalizeSlashCommand(command: string): string {
  const clean = command.trim();
  if (!/^\/[a-z][a-z-]*$/u.test(clean)) {
    throw new Error("Invalid Codex slash command");
  }
  return clean;
}

export async function runPalette(query: string): Promise<void> {
  const clean = normalizePaletteQuery(query);
  await runControlScript("palette", clean, "Command Menu control");
}

export async function runSlash(command: string): Promise<void> {
  const clean = normalizeSlashCommand(command);
  await runControlScript("slash", clean, "slash-command control");
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

export async function executeCommand(commandId: string, paletteOverride?: string): Promise<void> {
  const command = COMMANDS[commandId];
  if (!command) throw new Error(`Unknown Codex command: ${commandId}`);
  if (command.kind === "url") return openUrl(command.value);
  if (command.kind === "shortcut") return runShortcut(command.value);
  if (command.kind === "slash") return runSlash(command.value);
  if (command.kind === "reasoning") {
    await runReasoning(command.value === "increase" ? "increase" : "decrease");
    return;
  }
  return runPalette(paletteOverride?.trim() || command.value);
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
