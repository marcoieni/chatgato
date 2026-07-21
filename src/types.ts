export type AgentStatus =
  | "off"
  | "working"
  | "unread"
  | "idle"
  | "awaiting-approval"
  | "awaiting-response"
  | "error";

export type CodexThread = {
  id: string;
  title: string;
  cwd: string;
  rolloutPath: string;
  updatedAtMs: number;
  reasoningEffort: string | null;
  spawnStatus: string | null;
  status: AgentStatus;
};

export type AgentSettings = {
  slot?: number;
  cwdFilter?: string;
  pollSeconds?: number;
  acknowledgedThreadId?: string;
  acknowledgedAtMs?: number;
};

export type NewTaskSettings = {
  path?: string;
  prompt?: string;
  autoSubmit?: boolean;
  submitDelayMs?: number;
};

export type PushToTalkSettings = Record<string, never>;

export type FastModeSettings = {
  /** @deprecated Fast mode is read from Codex's config instead of Stream Deck settings. */
  enabled?: boolean;
};

export type PlanModeSettings = Record<string, never>;

export type ReasoningSettings = {
  maxStepsPerGesture?: number;
};

export type UsageSettings = {
  pollSeconds?: number;
};

export type CodexUsageWindow = {
  usedPercent: number;
  windowMinutes: number;
  resetsAtMs: number | null;
};

export type CodexUsageSnapshot = {
  updatedAtMs: number;
  primary: CodexUsageWindow | null;
  secondary: CodexUsageWindow | null;
  planType: string | null;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
};

export type RawRateLimitWindow = {
  used_percent?: unknown;
  window_minutes?: unknown;
  resets_at?: unknown;
};

export type RawRateLimits = {
  limit_id?: unknown;
  limit_name?: unknown;
  primary?: RawRateLimitWindow | null;
  secondary?: RawRateLimitWindow | null;
  plan_type?: unknown;
  credits?: {
    has_credits?: unknown;
    unlimited?: unknown;
    balance?: unknown;
  } | null;
};

export type RolloutRecord = {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    name?: string;
    call_id?: string;
    status?: string;
    phase?: string;
    input?: string;
    arguments?: string;
    collaboration_mode?: {
      mode?: unknown;
    };
    thread_settings?: {
      collaboration_mode?: {
        mode?: unknown;
      };
    };
    rate_limits?: RawRateLimits | null;
    [key: string]: unknown;
  };
};
