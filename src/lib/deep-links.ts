import type { NewTaskSettings, RunPromptSettings } from "../types.js";

// Compatibility only: older plugin versions stored a workflow name instead of
// the prompt itself. New and edited keys store exactly what the user entered.
const LEGACY_WORKFLOW_PROMPTS: Record<string, string> = {
  reviewPr:
    "Review the current pull request. Inspect the diff, identify correctness issues and regressions, and report findings ordered by severity.",
  debug:
    "Debug the current error. Reproduce it, identify the root cause, implement a focused fix, and verify it with relevant tests.",
  refactor:
    "Refactor the selected area for clarity and maintainability without changing behavior. Keep the change focused and verify it with tests.",
  tests:
    "Add or improve tests for the current change. Cover meaningful edge cases, run the relevant test suite, and summarize the result.",
  security:
    "Review the current changes for security vulnerabilities. Trace affected trust boundaries and report actionable findings ordered by severity.",
  docs:
    "Update the relevant documentation for the current change. Keep examples accurate, concise, and verified against the implementation.",
};

export function buildNewTaskUrl(settings: NewTaskSettings): string {
  const prompt = settings.prompt?.trim();
  const path = settings.path?.trim();

  if (!prompt && !path) {
    return "codex://threads/new";
  }

  const params = new URLSearchParams();
  if (prompt) params.set("prompt", prompt);
  if (path) params.set("path", path);
  return `codex://threads/new?${params.toString()}`;
}

function buildLegacyWorkflowPrompt(settings: RunPromptSettings): string {
  if (
    settings.workflow === undefined &&
    settings.customPrompt === undefined &&
    settings.skillName === undefined
  ) {
    return "";
  }

  const base =
    settings.workflow === "custom"
      ? settings.customPrompt?.trim() ?? ""
      : LEGACY_WORKFLOW_PROMPTS[settings.workflow ?? "reviewPr"] ??
        LEGACY_WORKFLOW_PROMPTS.reviewPr ??
        "";
  const skill = settings.skillName?.trim().replace(/^\$/, "");
  return skill ? `$${skill} ${base}`.trim() : base;
}

export function buildRunPrompt(settings: RunPromptSettings): string {
  if (settings.prompt !== undefined) {
    return settings.prompt.trim();
  }
  return buildLegacyWorkflowPrompt(settings);
}

export function buildRunPromptUrl(settings: RunPromptSettings): string {
  return buildNewTaskUrl({
    path: settings.path,
    prompt: buildRunPrompt(settings),
  });
}

export function buildThreadUrl(threadId: string): string {
  if (!/^[0-9a-z-]+$/i.test(threadId)) {
    throw new Error("Invalid Codex thread id");
  }
  return `codex://threads/${threadId}`;
}
