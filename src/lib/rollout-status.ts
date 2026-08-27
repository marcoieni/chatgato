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
const APPROVED_PREFIXES_HEADING = "## Approved command prefixes";
const APPROVED_PREFIX_ARRAY = /\[(?:\s*"(?:[^"\\]|\\.)*"\s*,?\s*)+\]/gu;
const ESCALATED_SANDBOX_PROPERTY =
  /(?:^|[{,]\s*)["']?sandbox_permissions["']?\s*:\s*["']require_escalated["'](?=\s*[,}])/u;
const BROWSER_FILE_UPLOAD_CALL =
  /\btools\.mcp__node_repl__js\s*\(\s*\{[\s\S]*?\.setFiles\s*\(/u;
const COMMAND_PROPERTY =
  /(?:^|[{,]\s*)["']?cmd["']?\s*:\s*("(?:[^"\\]|\\.)*")/u;
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

function approvedPrefixesFromRecord(record: RolloutRecord): string[][] | null {
  if (
    record.type !== "response_item" ||
    record.payload?.type !== "message" ||
    record.payload.role !== "developer" ||
    !Array.isArray(record.payload.content)
  ) {
    return null;
  }

  for (const item of record.payload.content) {
    if (!item || typeof item !== "object") continue;
    const text = "text" in item ? item.text : undefined;
    if (typeof text !== "string") continue;
    const headingAt = text.indexOf(APPROVED_PREFIXES_HEADING);
    if (headingAt < 0) continue;

    const prefixes: string[][] = [];
    for (const match of text.slice(headingAt).matchAll(APPROVED_PREFIX_ARRAY)) {
      try {
        const prefix = JSON.parse(match[0]) as unknown;
        if (
          Array.isArray(prefix) &&
          prefix.length > 0 &&
          prefix.every((part): part is string => typeof part === "string")
        ) {
          prefixes.push(prefix);
        }
      } catch {
        // Ignore malformed prose that merely resembles a command prefix.
      }
    }
    return prefixes;
  }

  return null;
}

export function latestApprovalContext(
  records: readonly RolloutRecord[],
): RolloutRecord | null {
  let context: RolloutRecord | null = null;
  for (const record of records) {
    if (approvedPrefixesFromRecord(record) !== null) context = record;
  }
  return context;
}

export function hasPendingEscalatedToolCall(
  records: readonly RolloutRecord[],
): boolean {
  const pendingCallIds = new Set<string>();
  let hasAnonymousPendingCall = false;

  for (const record of records) {
    if (record.type !== "response_item") continue;
    const payloadType = record.payload?.type ?? "";
    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      const input = record.payload?.input ?? record.payload?.arguments;
      if (typeof input === "string" && ESCALATED_SANDBOX_PROPERTY.test(input)) {
        const callId = record.payload?.call_id;
        if (typeof callId === "string") pendingCallIds.add(callId);
        else hasAnonymousPendingCall = true;
      }
    } else if (payloadType.endsWith("_output")) {
      const callId = record.payload?.call_id;
      if (typeof callId === "string") pendingCallIds.delete(callId);
      else hasAnonymousPendingCall = false;
    }
  }

  return pendingCallIds.size > 0 || hasAnonymousPendingCall;
}

function commandFromToolInput(input: string): string | null {
  const encoded = COMMAND_PROPERTY.exec(input)?.[1];
  if (!encoded) return null;
  try {
    const command = JSON.parse(encoded) as unknown;
    return typeof command === "string" ? command : null;
  } catch {
    return null;
  }
}

function simpleCommandTokens(command: string): string[] | null {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  for (const character of command.trim()) {
    if (escaping) {
      token += character;
      escaping = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (character === "\n" || character === "\r") return null;
      if (token) {
        tokens.push(token);
        token = "";
      }
      continue;
    }
    // Shell control, expansion, redirection, and glob syntax are not covered by
    // a reusable simple-command prefix. Be conservative when any is present.
    if (/[|&;()<>`$*?]/u.test(character)) return null;
    token += character;
  }

  if (escaping || quote) return null;
  if (token) tokens.push(token);
  return tokens.length > 0 ? tokens : null;
}

function isCoveredByApprovedPrefix(
  input: string,
  approvedPrefixes: readonly (readonly string[])[],
): boolean {
  const command = commandFromToolInput(input);
  const tokens = command === null ? null : simpleCommandTokens(command);
  if (!tokens || /^[^=\s]+=/.test(tokens[0]!)) return false;

  return approvedPrefixes.some(
    (prefix) =>
      prefix.length <= tokens.length &&
      prefix.every((part, index) => tokens[index] === part),
  );
}

function isApprovalToolCall(
  record: RolloutRecord,
  approvedPrefixes: readonly (readonly string[])[],
): boolean {
  if (record.type !== "response_item") return false;
  if (
    record.payload?.type !== "function_call" &&
    record.payload?.type !== "custom_tool_call"
  ) {
    return false;
  }

  const input = record.payload.input ?? record.payload.arguments;
  // Browser uploads pause for an in-app data-transmission approval before the
  // tool produces its matching output. The rollout persists only the pending
  // setFiles call, so recognize that boundary explicitly. A normal apply_patch
  // has the same pending call shape as a gated one, so only treat an escalated
  // command as approval-bound when the turn's permissions do not authorize it.
  return (
    typeof input === "string" &&
    (BROWSER_FILE_UPLOAD_CALL.test(input) ||
      (ESCALATED_SANDBOX_PROPERTY.test(input) &&
        !isCoveredByApprovedPrefix(input, approvedPrefixes)))
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
  let approvedPrefixes: string[][] = [];

  for (const record of records) {
    const recordedPrefixes = approvedPrefixesFromRecord(record);
    if (recordedPrefixes !== null) approvedPrefixes = recordedPrefixes;

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
        status = isApprovalToolCall(record, approvedPrefixes)
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
  // Once completed output has gone quiet, avoid leaving that chat blue forever.
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
