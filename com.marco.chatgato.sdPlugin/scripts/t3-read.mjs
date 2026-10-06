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
    ["preparing", "starting", "running", "waiting"].includes(row.active_status)
  )
    return "working";
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
        WHERE thread_id = t.thread_id AND status IN ('preparing', 'starting', 'running', 'waiting')
        ORDER BY ordinal DESC LIMIT 1) AS active_status,
      (SELECT COUNT(*) FROM orchestration_v2_projection_runtime_requests
        WHERE thread_id = t.thread_id AND status = 'pending'
        AND kind IN ('command', 'file-read', 'file-change', 'permission')) AS approvals,
      (SELECT COUNT(*) FROM orchestration_v2_projection_runtime_requests
        WHERE thread_id = t.thread_id AND status = 'pending'
        AND kind IN ('user_input', 'mcp-elicitation', 'auth_refresh')) AS inputs
    FROM orchestration_v2_projection_threads t
    JOIN projection_projects p ON p.project_id = t.project_id
    LEFT JOIN orchestration_v2_projection_runs r ON r.run_id = (
      SELECT run_id FROM orchestration_v2_projection_runs
      WHERE thread_id = t.thread_id AND status <> 'queued'
      ORDER BY ordinal DESC LIMIT 1)
    WHERE t.deleted_at IS NULL AND t.archived_at IS NULL AND p.deleted_at IS NULL
      AND json_extract(t.payload_json, '$.lineage.parentThreadId') IS NULL
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
    LEFT JOIN projection_turns r ON r.row_id = (
      SELECT row_id FROM projection_turns WHERE thread_id = t.thread_id
      ORDER BY requested_at DESC, row_id DESC LIMIT 1)
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
