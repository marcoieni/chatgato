import type { AgentStatus, RolloutRecord } from "../types.js";

const COMPLETED = new Set([
  "task_complete",
  "task_completed",
  "turn_complete",
  "turn_completed",
]);
const ABORTED = new Set([
  "task_aborted",
  "task_cancelled",
  "task_failed",
  "turn_aborted",
  "turn_failed",
]);
const WAITING_APPROVAL = new Set([
  "exec_approval_request",
  "apply_patch_approval_request",
  "mcp_approval_request",
  "approval_request",
]);
const WAITING_RESPONSE = new Set([
  "request_user_input",
  "elicitation_request",
  "user_input_request",
]);
const ESCALATED_SANDBOX_PROPERTY =
  /(?:^|[{,]\s*)["']?sandbox_permissions["']?\s*:\s*["']require_escalated["'](?=\s*[,}])/u;
const APPLY_PATCH_CALL = /\b(?:tools\.)?apply_patch\s*\(/u;
export const STALE_WORKING_TIMEOUT_MS = 10 * 60 * 1000;

export function planModeFromRollout(
  records: readonly RolloutRecord[],
): boolean {
  let mode = "default";

  for (const record of records) {
    const candidate =
      record.type === "turn_context"
        ? record.payload?.collaboration_mode?.mode
        : record.type === "event_msg" &&
            record.payload?.type === "thread_settings_applied"
          ? record.payload.thread_settings?.collaboration_mode?.mode
          : undefined;
    if (candidate === "default" || candidate === "plan") mode = candidate;
  }

  return mode === "plan";
}

function timestampMs(record: RolloutRecord): number | null {
  const parsed = Date.parse(record.timestamp ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function isApprovalToolCall(record: RolloutRecord): boolean {
  if (record.type !== "response_item") return false;
  if (
    record.payload?.type !== "function_call" &&
    record.payload?.type !== "custom_tool_call"
  ) {
    return false;
  }

  const input = record.payload.input ?? record.payload.arguments;
  return (
    record.payload.name === "apply_patch" ||
    (typeof input === "string" &&
      (ESCALATED_SANDBOX_PROPERTY.test(input) || APPLY_PATCH_CALL.test(input)))
  );
}

export function statusFromSpawnEdge(
  spawnStatus?: string | null,
): AgentStatus | null {
  switch (spawnStatus?.toLowerCase()) {
    case "queued":
    case "pending":
    case "running":
    case "working":
      return "working";
    case "waiting":
    case "blocked":
    case "needs-input":
      return "awaiting-response";
    case "completed":
    case "complete":
    case "done":
      return "unread";
    case "cancelled":
    case "canceled":
    case "failed":
    case "error":
      return "error";
    default:
      return null;
  }
}

export function inferRolloutStatus(
  records: readonly RolloutRecord[],
  spawnStatus?: string | null,
  nowMs = Date.now(),
): AgentStatus {
  const spawnEdgeStatus = statusFromSpawnEdge(spawnStatus);
  let status = spawnEdgeStatus ?? "idle";
  let lastWorkingAtMs: number | null = null;
  const pendingToolCallIds = new Set<string>();
  let hasAnonymousPendingToolCall = false;

  for (const record of records) {
    const outer = record.type ?? "";
    const payloadType = record.payload?.type ?? "";
    const name = record.payload?.name ?? "";
    const phase =
      typeof record.payload?.phase === "string" ? record.payload.phase : "";
    const recordAtMs = timestampMs(record);

    if (payloadType === "task_started" || payloadType === "user_message") {
      status = "working";
      lastWorkingAtMs = recordAtMs ?? lastWorkingAtMs;
      continue;
    }
    if (COMPLETED.has(payloadType)) {
      status = "unread";
      continue;
    }
    if (ABORTED.has(payloadType)) {
      status = "error";
      continue;
    }
    if (WAITING_APPROVAL.has(payloadType)) {
      status = "awaiting-approval";
      continue;
    }
    if (WAITING_RESPONSE.has(payloadType)) {
      status = "awaiting-response";
      continue;
    }

    if (outer === "response_item") {
      if (payloadType === "reasoning") {
        status = "working";
        lastWorkingAtMs = recordAtMs ?? lastWorkingAtMs;
      } else if (payloadType === "message") {
        if (phase === "final_answer") {
          status = "unread";
        } else {
          status = "working";
          lastWorkingAtMs = recordAtMs ?? lastWorkingAtMs;
        }
      } else if (
        payloadType === "function_call" ||
        payloadType === "custom_tool_call"
      ) {
        status = isApprovalToolCall(record)
          ? "awaiting-approval"
          : WAITING_RESPONSE.has(name)
            ? "awaiting-response"
            : "working";
        lastWorkingAtMs = recordAtMs ?? lastWorkingAtMs;
        if (status === "working") {
          const callId = record.payload?.call_id;
          if (typeof callId === "string") pendingToolCallIds.add(callId);
          else hasAnonymousPendingToolCall = true;
        }
      } else if (payloadType.endsWith("_output")) {
        status = "working";
        lastWorkingAtMs = recordAtMs ?? lastWorkingAtMs;
        const callId = record.payload?.call_id;
        if (typeof callId === "string") pendingToolCallIds.delete(callId);
        else hasAnonymousPendingToolCall = false;
      }
    }
  }

  // A Codex runtime restart can interrupt a turn before it writes task_complete.
  // Once completed output has gone quiet, avoid leaving that task blue forever.
  // A live spawn edge or an outstanding tool call remains authoritative because
  // either may legitimately be silent for longer than this fallback window.
  if (
    status === "working" &&
    spawnEdgeStatus !== "working" &&
    pendingToolCallIds.size === 0 &&
    !hasAnonymousPendingToolCall &&
    lastWorkingAtMs !== null &&
    nowMs - lastWorkingAtMs >= STALE_WORKING_TIMEOUT_MS
  ) {
    return "unread";
  }

  return status;
}

export function parseRolloutLines(text: string): RolloutRecord[] {
  const records: RolloutRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as RolloutRecord);
    } catch {
      // A partial first line is expected when reading only the tail of a rollout.
    }
  }
  return records;
}
