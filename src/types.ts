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
  rolloutPath: string | null;
  remoteHostId?: string;
  updatedAtMs: number;
  reasoningEffort: string | null;
  spawnStatus: string | null;
  status: AgentStatus;
  subtaskStatuses?: AgentStatus[];
};

export type AgentSettings = {
  slot?: number;
  cwdFilter?: string;
  pollSeconds?: number;
  acknowledgedThreadId?: string;
  acknowledgedAtMs?: number;
};

export type NewChatSettings = {
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

export type CodexRateLimitReachedType =
  | "rate_limit_reached"
  | "workspace_owner_credits_depleted"
  | "workspace_member_credits_depleted"
  | "workspace_owner_usage_limit_reached"
  | "workspace_member_usage_limit_reached"
  | (string & {});

export type CodexRateLimitResetCredit = {
  id: string;
  resetType: string;
  status: string;
  grantedAtMs: number;
  expiresAtMs: number | null;
  title: string | null;
  description: string | null;
};

export type CodexRateLimitResetCredits = {
  availableCount: number;
  credits: CodexRateLimitResetCredit[] | null;
};

export type CodexUsageSnapshot = {
  updatedAtMs: number;
  primary: CodexUsageWindow | null;
  secondary: CodexUsageWindow | null;
  planType: string | null;
  rateLimitReachedType: CodexRateLimitReachedType | null;
  resetCredits: CodexRateLimitResetCredits | null;
  credits: {
    hasCredits: boolean;
    unlimited: boolean;
    balance: string | null;
  } | null;
};

export type CodexAccountUsageDailyBucket = {
  startDate: string;
  tokens: number;
};

export type CodexAccountUsageSnapshot = {
  updatedAtMs: number;
  summary: {
    lifetimeTokens: number | null;
    peakDailyTokens: number | null;
    longestRunningTurnSeconds: number | null;
    currentStreakDays: number | null;
    longestStreakDays: number | null;
  };
  dailyUsageBuckets: CodexAccountUsageDailyBucket[] | null;
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
    [key: string]: unknown;
  };
};
