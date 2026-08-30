import {
  compactDuration,
  compactTokenCount,
  remainingPercent,
  resetCountdownLabel,
  usageWindowLabel,
} from "./codex-usage.js";
import {
  AGENT_STATUS_ICON_SOURCES,
  DYNAMIC_ICON_SOURCES,
  LUCIDE_LICENSE,
  lucideGlyph,
} from "./lucide.js";
import type {
  AgentStatus,
  CodexAccountUsageSnapshot,
  CodexRateLimitReachedType,
  CodexThread,
  CodexUsageSnapshot,
} from "../types.js";

// Status colors used by ChatGato actions.
export const STATUS_COLORS: Record<AgentStatus, string> = {
  off: "#303840",
  working: "#304FFE",
  unread: "#00FF4C",
  idle: "#FFFFFF",
  "awaiting-approval": "#FF6D00",
  "awaiting-response": "#9E5BFF",
  error: "#FF0033",
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  off: "OFF",
  working: "WORKING",
  unread: "DONE",
  idle: "",
  "awaiting-approval": "APPROVAL",
  "awaiting-response": "INPUT",
  error: "ERROR",
};

export const FAST_MODE_COLORS = {
  off: "#303840",
  on: "#FFD600",
} as const;

export const PLAN_MODE_COLORS = {
  off: "#303840",
  on: FAST_MODE_COLORS.on,
} as const;

export const PUSH_TO_TALK_COLORS = {
  idle: "#303840",
  active: "#FFD600",
} as const;

const KEY_BACKGROUND = "#071018";
const KEY_GLYPH_CENTER = [72, 54] as const;
const PROJECT_LABEL_FONT_SIZE = 20;
const PROJECT_LABEL_WIDTH = 112;
const CHAT_TITLE_FONT_SIZE = 17;
const CHAT_TITLE_WIDTH = 116;
const CHAT_TITLE_WRAP_WIDTH = 130;
const SUBTASK_BAR_PENDING_COLOR = "#9E5BFF";
const SUBTASK_BAR_HEIGHT = 4;
const SUBTASK_BAR_WIDTH = 108;
const SUBTASK_BAR_X = 18;
const SUBTASK_BAR_Y = 14;

function keyShell(): string {
  return `<rect width="144" height="144" rx="24" fill="${KEY_BACKGROUND}"/>
    <rect x="8" y="8" width="128" height="128" rx="20" fill="none" stroke="#FFFFFF" stroke-opacity=".12" stroke-width="2"/>`;
}

function accentPanel(color: string): string {
  return `<rect x="28" y="14" width="88" height="80" rx="22" fill="${color}"/>`;
}

function centeredGlyph(
  glyph: string,
  sourceCenter: readonly [number, number] = KEY_GLYPH_CENTER,
): string {
  const [sourceX, sourceY] = sourceCenter;
  const [targetX, targetY] = KEY_GLYPH_CENTER;
  return `<g data-source-center="${sourceX} ${sourceY}" data-glyph-center="${targetX} ${targetY}" transform="translate(${targetX - sourceX} ${targetY - sourceY})">
      ${glyph}
    </g>`;
}

export function effectiveStatus(
  thread: CodexThread,
  acknowledgedThreadId?: string,
  acknowledgedAtMs?: number,
): AgentStatus {
  if (
    thread.status === "unread" &&
    acknowledgedThreadId === thread.id &&
    (acknowledgedAtMs ?? 0) >= thread.updatedAtMs
  ) {
    return "idle";
  }
  return thread.status;
}

type AgentVisualThread = Pick<CodexThread, "title" | "cwd"> & {
  subtaskStatuses?: readonly AgentStatus[];
};

function subtaskProgressBar(
  statuses: readonly AgentStatus[] | undefined,
): string {
  if (!statuses?.length) return "";

  const orderedStatuses = [...statuses].sort(
    (left, right) => Number(right === "unread") - Number(left === "unread"),
  );
  const gap = Math.min(1.5, SUBTASK_BAR_WIDTH / (statuses.length * 3));
  const segmentWidth =
    (SUBTASK_BAR_WIDTH - gap * (statuses.length - 1)) / statuses.length;
  const segments = orderedStatuses
    .map((status, index) => {
      const x = SUBTASK_BAR_X + index * (segmentWidth + gap);
      const completed = status === "unread";
      const failed = status === "error";
      const working = status === "working";
      const color = completed
        ? STATUS_COLORS.unread
        : working
          ? STATUS_COLORS.working
          : failed
            ? STATUS_COLORS.error
            : SUBTASK_BAR_PENDING_COLOR;
      const opacity = completed || working || failed ? 1 : 0.3;
      return `<rect data-subtask-status="${status}" x="${x.toFixed(2)}" y="${SUBTASK_BAR_Y}" width="${segmentWidth.toFixed(2)}" height="${SUBTASK_BAR_HEIGHT}" fill="${color}" opacity="${opacity}"/>`;
    })
    .join("\n        ");

  return `<g data-subtask-progress="true" clip-path="url(#subtask-progress-clip)">
        ${segments}
      </g>`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function projectName(cwd: string): string {
  const project = cwd.split(/[\\/]/u).filter(Boolean).at(-1)?.trim() || "Codex";
  const fittedProject = compactTextToWidth(
    project,
    PROJECT_LABEL_WIDTH,
    PROJECT_LABEL_FONT_SIZE,
  );
  if (fittedProject === project) return project;

  const compact = fittedProject.slice(0, -1).replace(/[-_.]+$/u, "");
  return `${compact || Array.from(project)[0]}…`;
}

function compactTextToWidth(
  value: string,
  width: number,
  fontSize: number,
): string {
  if (!value || estimatedEmWidth(value) * fontSize <= width) return value;

  const characters = Array.from(value);
  const availableEmWidth = width / fontSize - estimatedCharacterEmWidth("…");
  let compactEmWidth = 0;
  let compactLength = 0;

  while (compactLength < characters.length) {
    const characterWidth = estimatedCharacterEmWidth(
      characters[compactLength]!,
    );
    if (compactEmWidth + characterWidth > availableEmWidth) break;
    compactEmWidth += characterWidth;
    compactLength += 1;
  }

  const compact = characters
    .slice(0, Math.max(1, compactLength))
    .join("")
    .trimEnd();
  return `${compact || characters[0]}…`;
}

function chatTitleLines(title: string): string[] {
  const normalized = title.trim().replace(/\s+/gu, " ") || "Untitled chat";
  const words = normalized.split(" ");
  const lines: string[] = [];

  while (words.length > 0 && lines.length < 3) {
    if (lines.length === 2) {
      lines.push(
        compactTextToWidth(
          words.join(" "),
          CHAT_TITLE_WRAP_WIDTH,
          CHAT_TITLE_FONT_SIZE,
        ),
      );
      break;
    }

    let line = words.shift()!;
    while (words.length > 0) {
      const candidate = `${line} ${words[0]}`;
      if (
        estimatedEmWidth(candidate) * CHAT_TITLE_FONT_SIZE >
        CHAT_TITLE_WRAP_WIDTH
      ) {
        break;
      }
      line = candidate;
      words.shift();
    }
    lines.push(
      compactTextToWidth(line, CHAT_TITLE_WRAP_WIDTH, CHAT_TITLE_FONT_SIZE),
    );
  }

  return lines;
}

function estimatedCharacterEmWidth(character: string): number {
  if (character === " ") return 0.3;
  if (/[MW@#%&]/u.test(character)) return 0.9;
  if (/[fijlrtI1.,'!:|]/u.test(character)) return 0.34;
  if (/[A-Z]/u.test(character)) return 0.68;
  if (character.codePointAt(0)! > 0x7f) return 1;
  return 0.56;
}

function estimatedEmWidth(value: string): number {
  return Array.from(value).reduce(
    (width, character) => width + estimatedCharacterEmWidth(character),
    0,
  );
}

function fittedTitleAttributes(line: string): string {
  return estimatedEmWidth(line) * CHAT_TITLE_FONT_SIZE > CHAT_TITLE_WIDTH
    ? ` textLength="${CHAT_TITLE_WIDTH}" lengthAdjust="spacingAndGlyphs"`
    : "";
}

export function agentSvg(
  slot: number,
  status: AgentStatus,
  thread?: AgentVisualThread,
): string {
  const color = STATUS_COLORS[status];
  const statusLabel = STATUS_LABELS[status];
  const statusLabelColor = status === "off" ? "#9AA6B2" : color;
  const statusLabelRow = statusLabel
    ? `<text x="36" y="31" fill="${statusLabelColor}" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="800" font-size="11" letter-spacing=".3">${statusLabel}</text>`
    : "";
  const project = thread ? projectName(thread.cwd) : "CODEX";
  const title =
    thread?.title || (status === "error" ? "Codex offline" : "Empty slot");
  const titleLines = chatTitleLines(title);
  const firstTitleY =
    titleLines.length === 1 ? 102 : titleLines.length === 2 ? 92 : 82;
  const titleRows = titleLines
    .map(
      (line, index) =>
        `<text x="72" y="${firstTitleY + index * 20}" fill="#FFFFFF" fill-opacity=".84" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="700" font-size="${CHAT_TITLE_FONT_SIZE}"${fittedTitleAttributes(line)} text-anchor="middle">${escapeXml(line)}</text>`,
    )
    .join("\n      ");
  const statusIconSource = AGENT_STATUS_ICON_SOURCES[status];
  const statusGlyph =
    status === "unread"
      ? `<circle data-agent-status-icon="done" cx="24" cy="27" r="6" fill="${color}"/>`
      : statusIconSource
        ? lucideGlyph(statusIconSource, {
            center: [24, 27],
            color,
            size: 16,
            strokeWidth: 2.5,
          })
        : "";
  const subtaskBar = subtaskProgressBar(thread?.subtaskStatuses);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${LUCIDE_LICENSE}
    <defs><clipPath id="subtask-progress-clip"><rect x="${SUBTASK_BAR_X}" y="${SUBTASK_BAR_Y}" width="${SUBTASK_BAR_WIDTH}" height="${SUBTASK_BAR_HEIGHT}" rx="${SUBTASK_BAR_HEIGHT / 2}"/></clipPath></defs>
    ${keyShell()}
    <rect x="12" y="12" width="120" height="52" rx="12" fill="#FFFFFF" opacity=".08"/>
    ${subtaskBar}
    ${statusGlyph}
    ${statusLabelRow}
    <text x="124" y="31" fill="#FFFFFF" fill-opacity=".72" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="800" font-size="13" text-anchor="end">${slot}</text>
    <text x="72" y="56" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="850" font-size="${PROJECT_LABEL_FONT_SIZE}" text-anchor="middle">${escapeXml(project)}</text>
    ${titleRows}
  </svg>`;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function agentImage(
  slot: number,
  status: AgentStatus,
  thread?: AgentVisualThread,
): string {
  return svgDataUri(agentSvg(slot, status, thread));
}

export function reasoningSvg(
  direction: "increase" | "decrease" = "increase",
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${LUCIDE_LICENSE}
    <defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#304FFE"/><stop offset="1" stop-color="#9E5BFF"/></linearGradient></defs>
    ${keyShell()}
    ${accentPanel("url(#g)")}
    ${centeredGlyph(
      `${lucideGlyph(DYNAMIC_ICON_SOURCES.brain, {
        center: [62, 54],
        size: 48,
      })}
      ${lucideGlyph(DYNAMIC_ICON_SOURCES[direction], {
        center: [99, 54],
        size: 24,
      })}`,
    )}
  </svg>`;
}

export function fastModeSvg(enabled: boolean): string {
  const foreground = enabled ? FAST_MODE_COLORS.on : "#FFFFFF";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${LUCIDE_LICENSE}
    ${keyShell()}
    ${accentPanel(FAST_MODE_COLORS.off)}
    ${centeredGlyph(
      lucideGlyph(DYNAMIC_ICON_SOURCES.fast, {
        color: foreground,
      }),
    )}
  </svg>`;
}

export function fastModeImage(enabled: boolean): string {
  return svgDataUri(fastModeSvg(enabled));
}

export function planModeSvg(enabled: boolean): string {
  const foreground = enabled ? PLAN_MODE_COLORS.on : "#FFFFFF";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${LUCIDE_LICENSE}
    ${keyShell()}
    ${accentPanel(PLAN_MODE_COLORS.off)}
    ${centeredGlyph(
      lucideGlyph(DYNAMIC_ICON_SOURCES.plan, {
        color: foreground,
      }),
    )}
  </svg>`;
}

export function planModeImage(enabled: boolean): string {
  return svgDataUri(planModeSvg(enabled));
}

export function pushToTalkSvg(active: boolean): string {
  const color = active ? PUSH_TO_TALK_COLORS.active : PUSH_TO_TALK_COLORS.idle;
  const foreground = active ? "#071018" : "#FFFFFF";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${LUCIDE_LICENSE}
    ${keyShell()}
    ${accentPanel(color)}
    ${centeredGlyph(
      lucideGlyph(DYNAMIC_ICON_SOURCES.pushToTalk, {
        color: foreground,
      }),
    )}
  </svg>`;
}

export function pushToTalkImage(active: boolean): string {
  return svgDataUri(pushToTalkSvg(active));
}

function usageColor(percent: number): string {
  if (percent <= 10) return "#FF0033";
  if (percent <= 25) return "#FF6D00";
  return "#00FF4C";
}

export function usageSvg(
  usage: CodexUsageSnapshot | null,
  failed = false,
  nowMs = Date.now(),
): string {
  const shell = keyShell();
  if (failed) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
      ${shell}
      <text x="72" y="57" fill="#FF0033" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="20" text-anchor="middle">USAGE</text>
      <text x="72" y="88" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="24" text-anchor="middle">OFFLINE</text>
    </svg>`;
  }

  const windows = usage
    ? [usage.primary, usage.secondary].filter((window) => window !== null)
    : [];
  if (usage?.credits?.unlimited && windows.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
      ${shell}
      <text x="72" y="57" fill="#9AA6B2" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="20" text-anchor="middle">USAGE</text>
      <text x="72" y="88" fill="#00FF4C" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="24" text-anchor="middle">NO LIMIT</text>
    </svg>`;
  }
  if (windows.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
      ${shell}
      <text x="72" y="57" fill="#9AA6B2" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="20" text-anchor="middle">USAGE</text>
      <text x="72" y="88" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="24" text-anchor="middle">NO DATA</text>
    </svg>`;
  }

  const rows = windows
    .slice(0, 2)
    .map((window, index) => {
      const remaining = remainingPercent(window, nowMs);
      const color = usageColor(remaining);
      const hasFooter = Boolean(
        usage?.rateLimitReachedType ||
        (usage?.resetCredits?.availableCount ?? 0) > 0,
      );
      const y =
        windows.length === 1
          ? hasFooter
            ? 58
            : 66
          : (hasFooter ? 32 : 35) + index * (hasFooter ? 48 : 56);
      const width = Math.round((108 * remaining) / 100);
      const countdown = resetCountdownLabel(window.resetsAtMs, nowMs);
      return `<text x="18" y="${y}" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="18">${usageWindowLabel(window.windowMinutes)}</text>
      <text x="126" y="${y}" fill="${color}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="28" text-anchor="end">${remaining}%</text>
      ${countdown ? `<text data-reset-countdown="true" x="126" y="${y + 13}" fill="#9AA6B2" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="750" font-size="9" letter-spacing=".2" text-anchor="end">${countdown}</text>` : ""}
      <rect x="18" y="${y + 19}" width="108" height="8" rx="4" fill="#303840"/>
      <rect x="18" y="${y + 19}" width="${width}" height="8" rx="4" fill="${color}"/>`;
    })
    .join("\n");

  const footer = usage ? usageFooter(usage) : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${shell}
    ${rows}
    ${footer}
  </svg>`;
}

export function usageImage(
  usage: CodexUsageSnapshot | null,
  failed = false,
): string {
  return svgDataUri(usageSvg(usage, failed));
}

function usageFooter(usage: CodexUsageSnapshot): string {
  const reachedLabel = usageReachedLabel(usage.rateLimitReachedType);
  const resetCount = usage.resetCredits?.availableCount ?? 0;
  const resetLabel = resetCount > 0 ? `RESET ×${resetCount}` : null;
  if (!reachedLabel && !resetLabel) return "";

  if (reachedLabel && resetLabel) {
    return `${usageBadge(reachedLabel, 8, 78, "#FF6D00")}
    ${usageBadge(resetLabel, 90, 46, "#9E5BFF")}`;
  }
  return usageBadge(
    reachedLabel ?? resetLabel!,
    27,
    90,
    reachedLabel ? "#FF6D00" : "#9E5BFF",
  );
}

function usageBadge(
  label: string,
  x: number,
  width: number,
  color: string,
): string {
  return `<g data-usage-badge="${escapeXml(label)}">
      <rect x="${x}" y="116" width="${width}" height="17" rx="8.5" fill="${color}" fill-opacity=".2" stroke="${color}" stroke-opacity=".7"/>
      <text x="${x + width / 2}" y="128" fill="${color}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="850" font-size="8" text-anchor="middle"${label.length > 10 ? ` textLength="${width - 10}" lengthAdjust="spacingAndGlyphs"` : ""}>${escapeXml(label)}</text>
    </g>`;
}

function usageReachedLabel(
  reachedType: CodexRateLimitReachedType | null,
): string | null {
  switch (reachedType) {
    case null:
      return null;
    case "rate_limit_reached":
      return "RATE LIMIT";
    case "workspace_owner_credits_depleted":
      return "ORG CREDIT";
    case "workspace_member_credits_depleted":
      return "NO CREDITS";
    case "workspace_owner_usage_limit_reached":
      return "ORG CAP";
    case "workspace_member_usage_limit_reached":
      return "USAGE CAP";
    default:
      return "LIMITED";
  }
}

export function usageStatisticsSvg(
  usage: CodexAccountUsageSnapshot | null,
  failed = false,
): string {
  const shell = keyShell();
  if (failed) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
      ${shell}
      <text x="72" y="57" fill="#FF0033" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="18" text-anchor="middle">STATISTICS</text>
      <text x="72" y="88" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="24" text-anchor="middle">OFFLINE</text>
    </svg>`;
  }
  if (!usage) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
      ${shell}
      <text x="72" y="57" fill="#9AA6B2" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="18" text-anchor="middle">STATISTICS</text>
      <text x="72" y="88" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="24" text-anchor="middle">NO DATA</text>
    </svg>`;
  }

  const summary = usage.summary;
  const streak = `${compactTokenCount(summary.currentStreakDays)}/${compactTokenCount(summary.longestStreakDays)}D`;
  const bars = usageDailyBars(usage.dailyUsageBuckets ?? []);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${shell}
    <text x="16" y="23" fill="#9AA6B2" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="10" letter-spacing=".5">LIFETIME TOKENS</text>
    <text x="128" y="54" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="850" font-size="30" text-anchor="end">${compactTokenCount(summary.lifetimeTokens)}</text>
    ${bars}
    <text x="16" y="110" fill="#9AA6B2" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="9">DAILY</text>
    <text x="128" y="110" fill="#9E5BFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="9" text-anchor="end">PEAK ${compactTokenCount(summary.peakDailyTokens)}</text>
    <text x="16" y="128" fill="#00FF4C" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="9">STREAK ${streak}</text>
    <text x="128" y="128" fill="#304FFE" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="9" text-anchor="end">TURN ${compactDuration(summary.longestRunningTurnSeconds)}</text>
  </svg>`;
}

function usageDailyBars(
  values: CodexAccountUsageSnapshot["dailyUsageBuckets"],
): string {
  const buckets = [...(values ?? [])]
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .slice(-7);
  const padded = [
    ...Array.from({ length: Math.max(0, 7 - buckets.length) }, () => null),
    ...buckets,
  ];
  const maximum = Math.max(1, ...buckets.map(({ tokens }) => tokens));
  return padded
    .map((bucket, index) => {
      const height = bucket
        ? bucket.tokens === 0
          ? 2
          : Math.max(3, Math.round((32 * bucket.tokens) / maximum))
        : 2;
      const x = 16 + index * 16;
      const y = 99 - height;
      const color = index === padded.length - 1 ? "#00FF4C" : "#304FFE";
      return `<rect data-daily-tokens="${bucket?.tokens ?? 0}" x="${x}" y="${y}" width="12" height="${height}" rx="3" fill="${color}" opacity="${bucket ? 1 : 0.2}"/>`;
    })
    .join("\n    ");
}

export function usageStatisticsImage(
  usage: CodexAccountUsageSnapshot | null,
  failed = false,
): string {
  return svgDataUri(usageStatisticsSvg(usage, failed));
}
