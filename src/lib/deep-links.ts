import type { NewTaskSettings, WorkflowSettings } from "../types.js";

export const WORKFLOW_PROMPTS: Record<string, string> = {
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

export function buildWorkflowPrompt(settings: WorkflowSettings): string {
  const base =
    settings.workflow === "custom"
      ? settings.customPrompt?.trim() ?? ""
      : WORKFLOW_PROMPTS[settings.workflow ?? "reviewPr"] ?? WORKFLOW_PROMPTS.reviewPr ?? "";
  const skill = settings.skillName?.trim().replace(/^\$/, "");
  return skill ? `$${skill} ${base}`.trim() : base;
}

export function buildWorkflowUrl(settings: WorkflowSettings): string {
  return buildNewTaskUrl({
    path: settings.path,
    prompt: buildWorkflowPrompt(settings),
  });
}

export function buildThreadUrl(threadId: string): string {
  if (!/^[0-9a-z-]+$/i.test(threadId)) {
    throw new Error("Invalid Codex thread id");
  }
  return `codex://threads/${threadId}`;
}
