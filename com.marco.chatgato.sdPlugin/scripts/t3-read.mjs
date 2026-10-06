// This dependency-free reader also runs over SSH via stdin. Never write to
// T3's live database or copy a database file away from its WAL.
import { existsSync } from "node:fs";
import { Buffer } from "node:buffer";
import process from "node:process";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

const options = JSON.parse(
  Buffer.from(process.argv[2], "base64").toString("utf8"),
);
const home = options.home || process.env.T3CODE_HOME || join(homedir(), ".t3");
if (!isAbsolute(home)) throw new Error("T3 Code home must be an absolute path");
const stateDir = join(home, "userdata");
const v2Path = join(stateDir, "statev2.sqlite");
const db = new DatabaseSync(
  existsSync(v2Path) ? v2Path : join(stateDir, "state.sqlite"),
  {
    readOnly: true,
  },
);

function withinWorkspace(cwd, filter) {
  const child = relative(resolve(filter), resolve(cwd));
  return (
    child === "" ||
    (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  );
}

function status(row) {
  if (row.approvals > 0) return "awaiting-approval";
  if (row.inputs > 0) return "awaiting-response";
  if (
    ["preparing", "starting", "running", "waiting"].includes(
      row.active_status,
    )
  )
    return "working";
  // T3 leaves successors queued when the latest executed run hit a usage limit.
  if (
    row.blocking_failure_class === "usage_limit" &&
    (row.session_error == null ||
      row.session_error === row.blocking_failure_message)
  )
    return "error";
  if (row.active_status === "queued") return "working";
  if (
    row.session_status === "error" ||
    ["error", "failed"].includes(row.turn_status)
  )
    return "error";
  if (row.plan > 0) return "awaiting-response";
  if (row.turn_status === "completed") {
    return row.visited_at &&
      row.completed_at &&
      row.visited_at >= row.completed_at
      ? "idle"
      : "unread";
  }
  return "idle";
}

try {
  const v2 = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_v2_projection_threads'",
    )
    .get();
  const rows = db
    .prepare(
      v2
        ? `
    SELECT t.thread_id AS id, t.title, p.workspace_root AS project_cwd,
      COALESCE(json_extract(t.payload_json, '$.worktreePath'), p.workspace_root) AS cwd,
      t.updated_at, r.completed_at,
      json_extract(t.payload_json, '$.lastVisitedAt') AS visited_at,
      r.status AS turn_status,
      (SELECT status FROM orchestration_v2_projection_runs
        WHERE thread_id = t.thread_id AND status IN ('preparing', 'queued', 'starting', 'running', 'waiting')
        ORDER BY (status = 'queued'), ordinal DESC, run_id DESC LIMIT 1) AS active_status,
      json_extract(failure.payload_json, '$.failure.class') AS blocking_failure_class,
      json_extract(failure.payload_json, '$.failure.message') AS blocking_failure_message,
      (SELECT json_extract(session.payload_json, '$.lastError')
        FROM orchestration_v2_projection_provider_sessions session
        JOIN orchestration_v2_projection_provider_session_bindings binding
          ON binding.provider_session_id = session.provider_session_id
        WHERE binding.thread_id = t.thread_id
          AND session.provider_instance_id = t.provider_instance_id
        ORDER BY session.updated_at DESC, session.provider_session_id DESC LIMIT 1) AS session_error,
      (SELECT COUNT(*) FROM orchestration_v2_projection_runtime_requests
        WHERE thread_id = t.thread_id AND status = 'pending'
        AND kind IN ('command', 'file-read', 'file-change', 'permission')) AS approvals,
      (SELECT COUNT(*) FROM orchestration_v2_projection_runtime_requests
        WHERE thread_id = t.thread_id AND status = 'pending'
        AND kind IN ('user_input', 'mcp-elicitation', 'auth_refresh')) AS inputs,
      (json_extract(t.payload_json, '$.interactionMode') = 'plan' AND r.run_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM orchestration_v2_projection_plans
          WHERE thread_id = t.thread_id AND kind = 'proposed_plan' AND status = 'active')) AS plan
    FROM orchestration_v2_projection_threads t
    JOIN projection_projects p ON p.project_id = t.project_id
    LEFT JOIN orchestration_v2_projection_runs r ON r.run_id = (
      SELECT run_id FROM orchestration_v2_projection_runs
      WHERE thread_id = t.thread_id
      ORDER BY ordinal DESC LIMIT 1)
    LEFT JOIN orchestration_v2_projection_runs blocked ON blocked.run_id = (
      SELECT run_id FROM orchestration_v2_projection_runs
      WHERE thread_id = t.thread_id AND status <> 'queued'
        AND NOT (status = 'cancelled' AND json_extract(payload_json, '$.startedAt') IS NULL)
      ORDER BY ordinal DESC, run_id DESC LIMIT 1) AND blocked.status = 'failed'
    LEFT JOIN orchestration_v2_projection_turn_items failure ON failure.turn_item_id = (
      SELECT turn_item_id FROM orchestration_v2_projection_turn_items
      WHERE thread_id = t.thread_id AND run_id = blocked.run_id
        AND type = 'error' AND status = 'failed'
        AND node_id IS json_extract(blocked.payload_json, '$.rootNodeId')
      ORDER BY updated_at DESC, ordinal DESC, turn_item_id DESC LIMIT 1)
    WHERE t.deleted_at IS NULL AND t.archived_at IS NULL AND p.deleted_at IS NULL
      AND COALESCE(json_extract(t.payload_json, '$.lineage.relationshipToParent'), '') <> 'subagent'
    ORDER BY t.updated_at DESC, t.thread_id DESC
  `
        : `
    SELECT t.thread_id AS id, t.title, p.workspace_root AS project_cwd,
      COALESCE(t.worktree_path, p.workspace_root) AS cwd, t.updated_at,
      s.status AS session_status,
      CASE WHEN s.status IN ('starting', 'running') THEN s.status END AS active_status,
      r.state AS turn_status, r.completed_at,
      t.pending_approval_count AS approvals, t.pending_user_input_count AS inputs,
      t.has_actionable_proposed_plan AS plan
    FROM projection_threads t
    JOIN projection_projects p ON p.project_id = t.project_id
    LEFT JOIN projection_thread_sessions s ON s.thread_id = t.thread_id
    LEFT JOIN projection_turns r ON r.thread_id = t.thread_id
      AND r.turn_id = t.latest_turn_id
    WHERE t.deleted_at IS NULL AND t.archived_at IS NULL AND p.deleted_at IS NULL
    ORDER BY t.updated_at DESC, t.thread_id DESC
  `,
    )
    .all();
  const threads = rows
    .filter(
      (row) =>
        !options.cwdFilter ||
        withinWorkspace(row.cwd, options.cwdFilter) ||
        withinWorkspace(row.project_cwd, options.cwdFilter),
    )
    .slice(0, 20)
    .map((row) => ({
      id: row.id,
      title: row.title || "Untitled thread",
      cwd: row.project_cwd,
      updatedAtMs: Math.max(
        Date.parse(row.updated_at) || 0,
        Date.parse(row.completed_at) || 0,
      ),
      status: status(row),
    }));
  process.stdout.write(JSON.stringify(threads));
} finally {
  db.close();
}
