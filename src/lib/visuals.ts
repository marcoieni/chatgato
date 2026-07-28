import { remainingPercent, usageWindowLabel } from "./codex-usage.js";
import { DYNAMIC_ICON_SOURCES, LUCIDE_LICENSE, lucideGlyph } from "./lucide.js";
import type { AgentStatus, CodexThread, CodexUsageSnapshot } from "../types.js";

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

export const STATUS_LABELS: Record<AgentStatus, string> = {
  off: "OFF",
  working: "WORKING",
  unread: "DONE",
  idle: "IDLE",
  "awaiting-approval": "APPROVE",
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

export function agentSvg(slot: number, status: AgentStatus): string {
  const color = STATUS_COLORS[status];
  const darkText =
    status === "idle" || status === "unread" || status === "awaiting-approval";
  const foreground = darkText ? "#071018" : "#FFFFFF";
  const fontSize = slot >= 10 ? 46 : 54;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${keyShell()}
    ${accentPanel(color)}
    ${centeredGlyph(`<text x="72" y="72" fill="${foreground}" font-family="Arial,sans-serif" font-weight="800" font-size="${fontSize}" text-anchor="middle">${slot}</text>`)}
  </svg>`;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function agentImage(slot: number, status: AgentStatus): string {
  return svgDataUri(agentSvg(slot, status));
}

export function keyTitle(thread: CodexThread, status: AgentStatus): string {
  const project = thread.cwd.split(/[\\/]/u).filter(Boolean).at(-1) || "Codex";
  const compactProject =
    project.length > 10 ? `${project.slice(0, 9)}…` : project;
  return `${STATUS_LABELS[status]}\n${compactProject}`;
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
      const remaining = remainingPercent(window);
      const color = usageColor(remaining);
      const y = windows.length === 1 ? 72 : 48 + index * 54;
      const width = Math.round((108 * remaining) / 100);
      return `<text x="18" y="${y}" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="20">${usageWindowLabel(window.windowMinutes)}</text>
      <text x="126" y="${y}" fill="${color}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="32" text-anchor="end">${remaining}%</text>
      <rect x="18" y="${y + 9}" width="108" height="9" rx="4.5" fill="#303840"/>
      <rect x="18" y="${y + 9}" width="${width}" height="9" rx="4.5" fill="${color}"/>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${shell}
    ${rows}
  </svg>`;
}

export function usageImage(
  usage: CodexUsageSnapshot | null,
  failed = false,
): string {
  return svgDataUri(usageSvg(usage, failed));
}
