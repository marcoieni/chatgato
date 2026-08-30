import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MAX_AGENT_SLOTS } from "./agent-slots.js";
import {
  CodexStore,
  normalizeThreadSearchQuery,
  type ReasoningDirection,
} from "./codex-store.js";
import { ReasoningTracker } from "./reasoning-tracker.js";

export { normalizeThreadSearchQuery } from "./codex-store.js";

export type ControllerCommand = {
  kind: "url" | "shortcut" | "slash";
  value: string;
};

export const COMMANDS: Record<string, ControllerCommand> = {
  approve: { kind: "shortcut", value: "approve" },
  decline: { kind: "shortcut", value: "decline" },
  forkThread: { kind: "shortcut", value: "forkThread" },
  submit: { kind: "shortcut", value: "submit" },
  terminal: { kind: "shortcut", value: "terminal" },
  review: { kind: "shortcut", value: "review" },
  openReview: { kind: "slash", value: "/review" },
  settings: { kind: "url", value: "codex://settings" },
  scheduled: { kind: "url", value: "codex://automations" },
  skills: { kind: "url", value: "codex://skills" },
  toggleFast: { kind: "shortcut", value: "toggleFastMode" },
  togglePlan: { kind: "shortcut", value: "togglePlanMode" },
  navigateBack: { kind: "shortcut", value: "navigateBack" },
  navigateForward: { kind: "shortcut", value: "navigateForward" },
  toggleSidebar: { kind: "shortcut", value: "toggleSidebar" },
};

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));
const appleScript = join(pluginDir, "scripts", "codex-control.applescript");
const powerShellScript = join(pluginDir, "scripts", "codex-control.ps1");
const reasoningTracker = new ReasoningTracker();
const THREAD_SEARCH_COMMAND = "searchChats";
const CUSTOM_SHORTCUT_COMMANDS: Record<
  string,
  { command: string; label: string }
> = {
  forkThread: {
    command: "forkThread",
    label: "Fork chat",
  },
  toggleFastMode: {
    command: "composer.toggleFastMode",
    label: "Toggle Fast mode",
  },
  togglePlanMode: {
    command: "composer.togglePlanMode",
    label: "Toggle plan mode",
  },
};
// Stream Deck can deliver adjacent key/dial events before the first automation finishes.
let reasoningQueue: Promise<unknown> = Promise.resolve();

function runSubprocess(executable: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
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
  mode: "shortcut" | "keybinding" | "slash" | "reasoning" | "thread",
  payload: string,
  capability: string,
  extraArguments: string[] = [],
): Promise<void> {
  if (process.platform === "darwin") {
    await runSubprocess("/usr/bin/osascript", [
      appleScript,
      mode,
      payload,
      ...extraArguments,
    ]);
    return;
  }
  if (process.platform === "win32") {
    await runSubprocess("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      powerShellScript,
      mode,
      payload,
      ...extraArguments,
    ]);
    return;
  }
  throw new Error(`Codex ${capability} is supported on macOS and Windows`);
}

export async function openUrl(url: string): Promise<void> {
  if (!/^(codex|https):\/\//.test(url))
    throw new Error("Unsupported URL scheme");
  if (process.platform === "darwin") {
    await runSubprocess("/usr/bin/open", [url]);
    return;
  }
  if (process.platform === "win32") {
    await runSubprocess("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      powerShellScript,
      "url",
      url,
    ]);
    return;
  }
  await runSubprocess("xdg-open", [url]);
}

export async function runShortcut(shortcut: string): Promise<void> {
  const customShortcut = CUSTOM_SHORTCUT_COMMANDS[shortcut];
  if (customShortcut) {
    const binding = await requireCodexKeybinding(
      customShortcut.command,
      customShortcut.label,
    );
    await runControlScript(
      "keybinding",
      binding,
      `${customShortcut.label} keyboard control`,
    );
    return;
  }
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

export function validateThreadSearchResultIndex(resultIndex: number): number {
  if (
    !Number.isSafeInteger(resultIndex) ||
    resultIndex < 0 ||
    resultIndex >= MAX_AGENT_SLOTS
  ) {
    throw new Error(
      `Codex chat search supports result indexes 0 through ${MAX_AGENT_SLOTS - 1}`,
    );
  }
  return resultIndex;
}

export async function openThreadBySearch(
  title: string,
  resultIndex = 0,
): Promise<void> {
  const query = normalizeThreadSearchQuery(title);
  const selectedResultIndex = validateThreadSearchResultIndex(resultIndex);
  const binding = await requireCodexKeybinding(
    THREAD_SEARCH_COMMAND,
    "Switch chat",
  );
  await runControlScript("thread", query, "host-aware chat navigation", [
    String(selectedResultIndex),
    String(MAX_AGENT_SLOTS - 1),
    binding,
  ]);
}

export function resolveCodexKeybinding(
  bindings: unknown,
  command: string,
  platform = process.platform,
): string | null {
  if (!Array.isArray(bindings)) return null;
  for (let index = bindings.length - 1; index >= 0; index -= 1) {
    const binding: unknown = bindings[index];
    if (!binding || typeof binding !== "object") continue;
    const candidate = binding as Record<string, unknown>;
    if (candidate.command !== command) continue;
    return typeof candidate.key === "string"
      ? normalizeCodexKeybinding(candidate.key, platform)
      : null;
  }
  return null;
}

export function hasThreadSearchShortcut(
  bindings: unknown,
  platform = process.platform,
): boolean {
  return (
    resolveCodexKeybinding(bindings, THREAD_SEARCH_COMMAND, platform) !== null
  );
}

function normalizeShortcutPart(part: string): string {
  if (part === "cmd" || part === "command") return "command";
  if (part === "ctrl" || part === "control") return "control";
  if (part === "cmdorctrl" || part === "commandorcontrol") return "primary";
  if (part === "option") return "alt";
  return part;
}

function normalizeCodexKeybinding(
  keybinding: string,
  platform: string,
): string | null {
  if (platform !== "darwin" && platform !== "win32") return null;
  const parts = keybinding
    .toLowerCase()
    .split("+")
    .map((part) => normalizeShortcutPart(part.trim()));
  if (parts.some((part) => part.length === 0)) return null;

  const modifiers = new Set<string>();
  let key: string | null = null;
  for (const part of parts) {
    const resolved =
      part === "primary"
        ? platform === "darwin"
          ? "command"
          : "control"
        : part;
    if (["command", "control", "alt", "shift"].includes(resolved)) {
      if (platform === "win32" && resolved === "command") return null;
      modifiers.add(resolved);
      continue;
    }
    if (key !== null) return null;
    const normalizedKey = normalizeKeyName(resolved);
    if (normalizedKey === null) return null;
    key = normalizedKey;
  }
  if (key === null) return null;

  return ["command", "control", "alt", "shift"]
    .filter((modifier) => modifiers.has(modifier))
    .concat(key)
    .join("+");
}

function normalizeKeyName(key: string): string | null {
  const aliases: Record<string, string> = {
    arrowdown: "down",
    arrowleft: "left",
    arrowright: "right",
    arrowup: "up",
    esc: "escape",
    forwarddelete: "delete",
    pagedown: "pagedown",
    pageup: "pageup",
    return: "enter",
  };
  const normalized = aliases[key] ?? key;
  const namedKeys = new Set([
    "backspace",
    "delete",
    "down",
    "end",
    "enter",
    "escape",
    "home",
    "insert",
    "left",
    "pagedown",
    "pageup",
    "plus",
    "right",
    "space",
    "tab",
    "up",
  ]);
  if (namedKeys.has(normalized) || /^f(?:[1-9]|1[0-9]|20)$/u.test(normalized)) {
    return normalized;
  }
  return normalized.length === 1 && /^[\x21-\x7e]$/u.test(normalized)
    ? normalized
    : null;
}

async function readCodexKeybindings(): Promise<unknown> {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  const bindingsPath = join(codexHome, "keybindings.json");
  try {
    const contents = await readFile(bindingsPath, "utf8");
    return JSON.parse(contents) as unknown;
  } catch {
    return null;
  }
}

async function requireCodexKeybinding(
  command: string,
  label: string,
): Promise<string> {
  const bindings = await readCodexKeybindings();
  const key = resolveCodexKeybinding(bindings, command);
  if (key === null) {
    throw new Error(
      `Configure Codex ${label} in Settings → Keyboard Shortcuts`,
    );
  }
  return key;
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
