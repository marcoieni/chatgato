import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CodexStore, type ReasoningDirection } from "./codex-store.js";
import { ReasoningTracker } from "./reasoning-tracker.js";

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
// Stream Deck can deliver adjacent key/dial events before the first automation finishes.
let reasoningQueue: Promise<unknown> = Promise.resolve();

type SubprocessOptions = {
  captureStdout?: boolean;
};

function runSubprocess(
  executable: string,
  args: string[],
  options: { captureStdout: true },
): Promise<string>;
function runSubprocess(
  executable: string,
  args: string[],
  options?: { captureStdout?: false },
): Promise<void>;
function runSubprocess(
  executable: string,
  args: string[],
  { captureStdout = false }: SubprocessOptions = {},
): Promise<string | void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(-4000);
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(captureStdout ? stdout.trim() : undefined);
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
  mode: "shortcut" | "slash" | "reasoning" | "thread",
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

export function normalizeThreadSearchQuery(title: string): string {
  const clean = title.trim().replace(/\s+/gu, " ").slice(0, 200);
  if (!clean) throw new Error("Thread title is required for task search");
  return clean;
}

export async function openThreadBySearch(
  title: string,
  resultIndex = 0,
): Promise<void> {
  const query = normalizeThreadSearchQuery(title);
  if (
    !Number.isSafeInteger(resultIndex) ||
    resultIndex < 0 ||
    resultIndex > 8
  ) {
    throw new Error("Codex task search supports result indexes 0 through 8");
  }
  await assertThreadSearchShortcutConfigured();
  await runControlScript("thread", query, "host-aware task navigation", [
    String(resultIndex),
  ]);
}

export function hasThreadSearchShortcut(
  bindings: unknown,
  platform = process.platform,
): boolean {
  if (!Array.isArray(bindings)) return false;
  return bindings.some((binding: unknown) => {
    if (!binding || typeof binding !== "object") return false;
    const { command, key } = binding as Record<string, unknown>;
    if (command !== THREAD_SEARCH_COMMAND || typeof key !== "string") {
      return false;
    }

    const parts = new Set(
      key
        .toLowerCase()
        .split("+")
        .map((part) => normalizeShortcutPart(part.trim())),
    );
    const primary =
      parts.has("primary") ||
      (platform === "darwin" && parts.has("command")) ||
      (platform === "win32" && parts.has("control"));
    return (
      parts.size === 4 &&
      primary &&
      parts.has("alt") &&
      parts.has("shift") &&
      parts.has("s")
    );
  });
}

export function shortcutWasLoadedAtLaunch(
  bindingModifiedAtMs: number,
  appStartedAtMs: number,
): boolean {
  return (
    Number.isFinite(bindingModifiedAtMs) &&
    Number.isFinite(appStartedAtMs) &&
    bindingModifiedAtMs < appStartedAtMs
  );
}

function normalizeShortcutPart(part: string): string {
  if (part === "cmd" || part === "command") return "command";
  if (part === "ctrl" || part === "control") return "control";
  if (part === "cmdorctrl" || part === "commandorcontrol") return "primary";
  if (part === "option") return "alt";
  return part;
}

async function assertThreadSearchShortcutConfigured(): Promise<void> {
  const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
  const bindingsPath = join(codexHome, "keybindings.json");
  let bindings: unknown;
  let bindingModifiedAtMs = Number.NaN;
  try {
    const contents = await readFile(bindingsPath, "utf8");
    const metadata = await stat(bindingsPath);
    bindings = JSON.parse(contents) as unknown;
    bindingModifiedAtMs = metadata.mtimeMs;
  } catch {
    bindings = null;
  }
  if (!hasThreadSearchShortcut(bindings)) {
    throw new Error(
      "Configure Codex Switch chat as Command+Option+Shift+S (macOS) or Ctrl+Alt+Shift+S (Windows)",
    );
  }

  const appStartedAtMs = await chatGptStartedAtMs();
  if (appStartedAtMs === null) {
    throw new Error(
      "Open ChatGPT after configuring the Switch chat shortcut, then try again",
    );
  }
  if (!shortcutWasLoadedAtLaunch(bindingModifiedAtMs, appStartedAtMs)) {
    throw new Error(
      "Restart ChatGPT to load the Switch chat shortcut before using remote task keys",
    );
  }
}

async function chatGptStartedAtMs(): Promise<number | null> {
  if (process.platform === "darwin") {
    try {
      const pids = (
        await runSubprocess("/usr/bin/pgrep", ["-x", "ChatGPT"], {
          captureStdout: true,
        })
      )
        .split(/\s+/u)
        .filter(Boolean);
      const startedAt = await Promise.all(
        pids.map(async (pid) =>
          Date.parse(
            await runSubprocess("/bin/ps", ["-o", "lstart=", "-p", pid], {
              captureStdout: true,
            }),
          ),
        ),
      );
      const valid = startedAt.filter(Number.isFinite);
      return valid.length > 0 ? Math.min(...valid) : null;
    } catch {
      return null;
    }
  }

  if (process.platform === "win32") {
    try {
      const startedAt = Date.parse(
        await runSubprocess(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$p = Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1; if ($p) { $p.StartTime.ToUniversalTime().ToString('o') }",
          ],
          { captureStdout: true },
        ),
      );
      return Number.isFinite(startedAt) ? startedAt : null;
    } catch {
      return null;
    }
  }

  return null;
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
