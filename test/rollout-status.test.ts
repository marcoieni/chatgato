import { describe, expect, it } from "vitest";
import {
  inferRolloutStatus,
  parseRolloutLines,
  planModeFromRollout,
  STALE_WORKING_TIMEOUT_MS,
} from "../src/lib/rollout-status.js";

describe("Codex rollout status", () => {
  it("tracks the latest persisted collaboration mode", () => {
    expect(
      planModeFromRollout([
        { type: "turn_context", payload: { collaboration_mode: { mode: "default" } } },
        {
          type: "event_msg",
          payload: {
            type: "thread_settings_applied",
            thread_settings: { collaboration_mode: { mode: "plan" } },
          },
        },
      ]),
    ).toBe(true);

    expect(
      planModeFromRollout([
        { type: "turn_context", payload: { collaboration_mode: { mode: "plan" } } },
        {
          type: "event_msg",
          payload: {
            type: "thread_settings_applied",
            thread_settings: { collaboration_mode: { mode: "default" } },
          },
        },
      ]),
    ).toBe(false);
  });

  it("tracks a working turn", () => {
    expect(
      inferRolloutStatus([
        { type: "event_msg", payload: { type: "task_started" } },
        { type: "response_item", payload: { type: "reasoning" } },
        { type: "response_item", payload: { type: "custom_tool_call", name: "exec" } },
      ]),
    ).toBe("working");
  });

  it("distinguishes approval and user-input waits", () => {
    expect(
      inferRolloutStatus([{ type: "event_msg", payload: { type: "exec_approval_request" } }]),
    ).toBe("awaiting-approval");
    expect(
      inferRolloutStatus([
        { type: "response_item", payload: { type: "function_call", name: "request_user_input" } },
      ]),
    ).toBe("awaiting-response");
  });

  it("recognizes a pending escalated command as an approval wait", () => {
    const callId = "call-needs-approval";
    const approvalCall = {
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        call_id: callId,
        status: "completed",
        input:
          'const result = await tools.exec_command({"cmd":"osascript test.scpt","sandbox_permissions":"require_escalated","justification":"Run the UI test?"});',
      },
    };

    expect(inferRolloutStatus([approvalCall])).toBe("awaiting-approval");
    expect(
      inferRolloutStatus([
        approvalCall,
        {
          type: "response_item",
          payload: { type: "custom_tool_call_output", call_id: callId },
        },
      ]),
    ).toBe("working");
  });

  it("does not mistake approval-related command text for an approval request", () => {
    expect(
      inferRolloutStatus([
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            name: "exec",
            input: String.raw`const result = await tools.exec_command({cmd: "rg 'sandbox_permissions: \\"require_escalated\\"' ."});`,
          },
        },
      ]),
    ).toBe("working");
  });

  it("marks a completed task unread", () => {
    expect(
      inferRolloutStatus([
        { type: "event_msg", payload: { type: "task_started" } },
        { type: "event_msg", payload: { type: "task_complete" } },
      ]),
    ).toBe("unread");
  });

  it("treats a final answer as completion when task_complete is missing", () => {
    expect(
      inferRolloutStatus([
        { type: "event_msg", payload: { type: "task_started" } },
        { type: "response_item", payload: { type: "message", phase: "final_answer" } },
      ]),
    ).toBe("unread");
  });

  it("expires a stale working rollout after a runtime interruption", () => {
    const startedAtMs = Date.parse("2026-07-16T08:00:00.000Z");
    const records = [
      {
        timestamp: new Date(startedAtMs).toISOString(),
        type: "event_msg",
        payload: { type: "task_started" },
      },
      {
        timestamp: new Date(startedAtMs + 1_000).toISOString(),
        type: "response_item",
        payload: { type: "custom_tool_call_output" },
      },
    ];

    expect(
      inferRolloutStatus(records, null, startedAtMs + STALE_WORKING_TIMEOUT_MS),
    ).toBe("working");
    expect(
      inferRolloutStatus(records, null, startedAtMs + 1_000 + STALE_WORKING_TIMEOUT_MS),
    ).toBe("unread");
  });

  it("does not expire explicit waits, live subagents, or pending tool calls", () => {
    const startedAtMs = Date.parse("2026-07-16T08:00:00.000Z");
    const staleNowMs = startedAtMs + STALE_WORKING_TIMEOUT_MS * 2;
    const atStart = new Date(startedAtMs).toISOString();

    expect(
      inferRolloutStatus(
        [{ timestamp: atStart, type: "event_msg", payload: { type: "exec_approval_request" } }],
        null,
        staleNowMs,
      ),
    ).toBe("awaiting-approval");
    expect(
      inferRolloutStatus(
        [{ timestamp: atStart, type: "response_item", payload: { type: "custom_tool_call" } }],
        null,
        staleNowMs,
      ),
    ).toBe("working");
    expect(
      inferRolloutStatus(
        [{ timestamp: atStart, type: "response_item", payload: { type: "custom_tool_call_output" } }],
        "running",
        staleNowMs,
      ),
    ).toBe("working");
    expect(
      inferRolloutStatus(
        [
          {
            timestamp: atStart,
            type: "response_item",
            payload: { type: "custom_tool_call", call_id: "still-running" },
          },
          {
            timestamp: atStart,
            type: "response_item",
            payload: { type: "custom_tool_call", call_id: "finished" },
          },
          {
            timestamp: atStart,
            type: "response_item",
            payload: { type: "custom_tool_call_output", call_id: "finished" },
          },
        ],
        null,
        staleNowMs,
      ),
    ).toBe("working");
  });

  it("uses subagent edge status when no newer rollout signal exists", () => {
    expect(inferRolloutStatus([], "running")).toBe("working");
    expect(inferRolloutStatus([], "completed")).toBe("unread");
    expect(inferRolloutStatus([], "failed")).toBe("error");
  });

  it("skips a partial tail line", () => {
    const text = `partial\n${JSON.stringify({ type: "event_msg", payload: { type: "task_started" } })}\n`;
    expect(parseRolloutLines(text)).toHaveLength(1);
  });
});
