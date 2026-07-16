import type { NewTaskSettings } from "../types.js";

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

export function buildThreadUrl(threadId: string): string {
  if (!/^[0-9a-z-]+$/i.test(threadId)) {
    throw new Error("Invalid Codex thread id");
  }
  return `codex://threads/${threadId}`;
}
