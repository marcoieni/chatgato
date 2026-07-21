import { basename } from "node:path";
import { remainingPercent, usageWindowLabel } from "./codex-usage.js";
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
  on: "#00FF4C",
} as const;

export const PLAN_MODE_COLORS = {
  off: "#303840",
  on: "#9E5BFF",
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
  const project = basename(thread.cwd) || "Codex";
  const compactProject =
    project.length > 10 ? `${project.slice(0, 9)}…` : project;
  return `${STATUS_LABELS[status]}\n${compactProject}`;
}

export function reasoningSvg(
  direction: "increase" | "decrease" = "increase",
): string {
  const arrow =
    direction === "increase"
      ? "M72 78V40M59 53l13-13 13 13"
      : "M72 38v38M59 63l13 13 13-13";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#304FFE"/><stop offset="1" stop-color="#9E5BFF"/></linearGradient></defs>
    ${keyShell()}
    ${accentPanel("url(#g)")}
    ${centeredGlyph(
      `<path d="M49 66c-8-5-5-17 4-18 2-11 18-13 24-4 11-3 20 9 14 18 9 5 5 19-6 19H58c-10 0-16-9-9-15z" fill="none" stroke="#FFFFFF" stroke-opacity=".45" stroke-width="5"/>
      <path d="${arrow}" fill="none" stroke="#FFFFFF" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
      direction === "increase" ? [70.25, 59.75] : [70.25, 58.75],
    )}
  </svg>`;
}

export function fastModeSvg(enabled: boolean): string {
  const color = enabled ? FAST_MODE_COLORS.on : FAST_MODE_COLORS.off;
  const foreground = enabled ? "#071018" : "#FFFFFF";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${keyShell()}
    ${accentPanel(color)}
    ${centeredGlyph(
      `<path d="M78 23 48 62h21l-4 29 31-45H76z" fill="${foreground}"/>`,
      [72, 57],
    )}
  </svg>`;
}

export function fastModeImage(enabled: boolean): string {
  return svgDataUri(fastModeSvg(enabled));
}

export function planModeSvg(enabled: boolean): string {
  const color = enabled ? PLAN_MODE_COLORS.on : PLAN_MODE_COLORS.off;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${keyShell()}
    ${accentPanel(color)}
    ${centeredGlyph(
      '<path d="M46 40l6 6 10-12M46 65l6 6 10-12M72 40h25M72 65h25" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',
      [71.5, 52.5],
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
    ${keyShell()}
    ${accentPanel(color)}
    ${centeredGlyph(
      `<rect x="59" y="25" width="26" height="39" rx="13" fill="none" stroke="${foreground}" stroke-width="7"/>
      <path d="M48 58v4c0 13 11 23 24 23s24-10 24-23v-4M72 85v8M60 93h24" fill="none" stroke="${foreground}" stroke-width="7" stroke-linecap="round"/>`,
      [72, 59],
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
      <text x="72" y="62" fill="#FF0033" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="18" text-anchor="middle">USAGE</text>
      <text x="72" y="86" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="700" font-size="15" text-anchor="middle">OFFLINE</text>
    </svg>`;
  }

  const windows = usage
    ? [usage.primary, usage.secondary].filter((window) => window !== null)
    : [];
  if (usage?.credits?.unlimited && windows.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
      ${shell}
      <text x="72" y="51" fill="#9AA6B2" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="700" font-size="14" text-anchor="middle">USAGE</text>
      <text x="72" y="82" fill="#00FF4C" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="19" text-anchor="middle">UNLIMITED</text>
    </svg>`;
  }
  if (windows.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
      ${shell}
      <text x="72" y="61" fill="#9AA6B2" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="18" text-anchor="middle">USAGE</text>
      <text x="72" y="84" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="700" font-size="14" text-anchor="middle">NO DATA</text>
    </svg>`;
  }

  const rows = windows
    .slice(0, 2)
    .map((window, index) => {
      const remaining = remainingPercent(window);
      const color = usageColor(remaining);
      const y = windows.length === 1 ? 66 : 50 + index * 45;
      const width = Math.round((104 * remaining) / 100);
      return `<text x="20" y="${y}" fill="#9AA6B2" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="14">${usageWindowLabel(window.windowMinutes)}</text>
      <text x="124" y="${y}" fill="${color}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="21" text-anchor="end">${remaining}%</text>
      <rect x="20" y="${y + 8}" width="104" height="7" rx="3.5" fill="#303840"/>
      <rect x="20" y="${y + 8}" width="${width}" height="7" rx="3.5" fill="${color}"/>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${shell}
    <text x="72" y="24" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="12" letter-spacing="1.5" text-anchor="middle">LEFT</text>
    ${rows}
  </svg>`;
}

export function usageImage(
  usage: CodexUsageSnapshot | null,
  failed = false,
): string {
  return svgDataUri(usageSvg(usage, failed));
}
