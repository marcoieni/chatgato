import type {
  AgentStatus,
  CodexUsageSnapshot,
  CodexUsageWindow,
} from "../types.js";

export type JsonObject = Record<string, unknown>;

export type CodexAppServerNotification = {
  method: string;
  params: JsonObject;
};

export type CodexAppServerThread = {
  cwd: string;
  id: string;
  parentThreadId: string | null;
  recencyAtMs: number;
  rolloutPath: string | null;
  status: AgentStatus | null;
  title: string;
  updatedAtMs: number;
};

export type CodexAppServerModel = {
  id: string;
  reasoningEfforts: string[];
};

export type CodexAppServerClientLike = {
  readConfig: () => Promise<JsonObject>;
  readModels: () => Promise<CodexAppServerModel[]>;
  readThreads: () => Promise<CodexAppServerThread[]>;
  readUsage: () => Promise<CodexUsageSnapshot>;
  subscribe: (
    listener: (notification: CodexAppServerNotification) => void,
  ) => () => void;
};

export function parseAppServerModel(
  value: unknown,
): CodexAppServerModel | null {
  const model = asObject(value);
  if (!model) return null;
  const id = model.id;
  if (typeof id !== "string" || !id) return null;
  const supported = Array.isArray(model.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
    : [];
  return {
    id,
    reasoningEfforts: supported.flatMap((option) => {
      const object = asObject(option);
      const effort = object?.reasoningEffort;
      return typeof effort === "string" && effort ? [effort] : [];
    }),
  };
}

export function parseAppServerThread(
  thread: JsonObject,
  latestTurnValue: unknown,
): CodexAppServerThread | null {
  if (typeof thread.id !== "string" || typeof thread.cwd !== "string") {
    return null;
  }
  const name = typeof thread.name === "string" ? thread.name.trim() : "";
  const preview =
    typeof thread.preview === "string"
      ? (thread.preview.split(/\r?\n/u)[0]?.trim() ?? "")
      : "";
  if (!name && !preview) return null;

  const latestTurn = asObject(latestTurnValue);
  const updatedAtMs = secondsToMilliseconds(thread.updatedAt);
  const turnUpdatedAtMs = Math.max(
    secondsToMilliseconds(latestTurn?.startedAt),
    secondsToMilliseconds(latestTurn?.completedAt),
  );
  return {
    cwd: thread.cwd,
    id: thread.id,
    parentThreadId:
      typeof thread.parentThreadId === "string" ? thread.parentThreadId : null,
    recencyAtMs:
      secondsToMilliseconds(thread.recencyAt) || turnUpdatedAtMs || updatedAtMs,
    rolloutPath: typeof thread.path === "string" ? thread.path : null,
    status: agentStatusFromAppServer(thread.status, latestTurn),
    title: name || preview || "Untitled chat",
    updatedAtMs: Math.max(updatedAtMs, turnUpdatedAtMs),
  };
}

/** Selects only the canonical `codex` account bucket. */
export function usageFromAppServerResult(
  result: unknown,
  updatedAtMs = Date.now(),
): CodexUsageSnapshot | null {
  const object = asObject(result);
  if (!object) return null;

  const multiBucketValue = object.rateLimitsByLimitId;
  let limits: JsonObject | null;
  if (multiBucketValue !== undefined && multiBucketValue !== null) {
    const buckets = asObject(multiBucketValue);
    if (!buckets) return null;
    limits = asObject(buckets.codex);
  } else {
    limits = asObject(object.rateLimits);
    if (limits && !isCanonicalCodexLimit(limits.limitId)) {
      limits = null;
    }
  }
  if (!limits) return null;

  const primary = parseWindow(limits.primary);
  const secondary = parseWindow(limits.secondary);
  const credits = parseCredits(limits.credits ?? object.credits);
  if (!primary && !secondary && !credits?.hasCredits && !credits?.unlimited) {
    return null;
  }

  const planType = limits.planType ?? object.planType;
  return {
    updatedAtMs,
    primary,
    secondary,
    planType: typeof planType === "string" ? planType : null,
    credits,
  };
}

export function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export function requireResultObject(
  method: string,
  message: JsonObject,
): JsonObject {
  const result = asObject(message.result);
  if (!result) throw new Error(`Invalid ${method} result from Codex`);
  return result;
}

function agentStatusFromAppServer(
  statusValue: unknown,
  turn: JsonObject | null,
): AgentStatus | null {
  const status = asObject(statusValue);
  const runtimeType =
    typeof status?.type === "string" ? status.type.toLowerCase() : "";
  const activeFlags = Array.isArray(status?.activeFlags)
    ? status.activeFlags.filter(
        (flag): flag is string => typeof flag === "string",
      )
    : [];
  const itemStates = Array.isArray(turn?.items)
    ? turn.items.flatMap((item) => {
        const object = asObject(item);
        return object
          ? [object.type, object.status].filter(
              (state): state is string => typeof state === "string",
            )
          : [];
      })
    : [];
  const waitingStates = [...activeFlags, ...itemStates].map((state) =>
    state.toLowerCase(),
  );
  if (waitingStates.some((state) => state.includes("approval"))) {
    return "awaiting-approval";
  }
  if (
    waitingStates.some(
      (state) =>
        state.includes("userinput") ||
        state.includes("user_input") ||
        state.includes("elicitation"),
    )
  ) {
    return "awaiting-response";
  }
  if (runtimeType === "systemerror") return "error";
  if (runtimeType === "active") return "working";

  const turnStatus =
    typeof turn?.status === "string" ? turn.status.toLowerCase() : "";
  switch (turnStatus) {
    case "completed":
      return "unread";
    case "inprogress":
    case "in_progress":
    case "running":
      return "working";
    case "failed":
    case "cancelled":
    case "canceled":
      return "error";
    case "interrupted":
      // A separate app-server process can see a desktop-owned active turn as
      // interrupted while it still has no completion timestamp. Defer to the
      // rollout in that ambiguous state instead of showing a false error.
      return turn?.completedAt === null || turn?.completedAt === undefined
        ? null
        : "error";
    default:
      return runtimeType === "idle" ? "idle" : null;
  }
}

function secondsToMilliseconds(value: unknown): number {
  const seconds = finiteNumber(value);
  return seconds === null ? 0 : seconds * 1_000;
}

function parseWindow(value: unknown): CodexUsageWindow | null {
  const window = asObject(value);
  if (!window) return null;
  const usedPercent = finiteNumber(window.usedPercent);
  const windowMinutes = finiteNumber(window.windowDurationMins);
  if (usedPercent === null || windowMinutes === null || windowMinutes <= 0) {
    return null;
  }

  const resetsAt = window.resetsAt;
  const resetsAtSeconds =
    resetsAt === null || resetsAt === undefined ? null : finiteNumber(resetsAt);
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    windowMinutes,
    resetsAtMs: resetsAtSeconds === null ? null : resetsAtSeconds * 1_000,
  };
}

function parseCredits(value: unknown): CodexUsageSnapshot["credits"] | null {
  const credits = asObject(value);
  if (!credits) return null;
  const balance = credits.balance;
  return {
    hasCredits: credits.hasCredits === true,
    unlimited: credits.unlimited === true,
    balance: balance === null || balance === undefined ? null : String(balance),
  };
}

function isCanonicalCodexLimit(limitId: unknown): boolean {
  return (
    typeof limitId !== "string" || limitId.trim() === "" || limitId === "codex"
  );
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}
