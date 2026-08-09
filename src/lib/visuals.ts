import { remainingPercent, usageWindowLabel } from "./codex-usage.js";
import {
  AGENT_STATUS_ICON_SOURCES,
  DYNAMIC_ICON_SOURCES,
  LUCIDE_LICENSE,
  lucideGlyph,
} from "./lucide.js";
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

type AgentVisualThread = Pick<CodexThread, "title" | "cwd">;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
    : normalized;
}

function projectName(cwd: string): string {
  const project = cwd.split(/[\\/]/u).filter(Boolean).at(-1) || "Codex";
  return compactText(project, 13);
}

function chatTitleLines(title: string, maxLength = 13): string[] {
  let remaining = title.trim().replace(/\s+/gu, " ") || "Untitled task";
  const lines: string[] = [];

  while (remaining && lines.length < 3) {
    if (remaining.length <= maxLength) {
      lines.push(remaining);
      break;
    }

    if (lines.length === 2) {
      lines.push(compactText(remaining, maxLength));
      break;
    }

    const lastSpace = remaining.lastIndexOf(" ", maxLength);
    const splitAt =
      lastSpace >= Math.ceil(maxLength / 2) ? lastSpace : maxLength;
    lines.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  return lines;
}

function estimatedEmWidth(value: string): number {
  return Array.from(value).reduce((width, character) => {
    if (character === " ") return width + 0.3;
    if (/[MW@#%&]/u.test(character)) return width + 0.9;
    if (/[fijlrtI1.,'!:|]/u.test(character)) return width + 0.34;
    if (/[A-Z]/u.test(character)) return width + 0.68;
    if (character.codePointAt(0)! > 0x7f) return width + 1;
    return width + 0.56;
  }, 0);
}

function fittedTitleAttributes(line: string): string {
  return estimatedEmWidth(line) * 21 > 116
    ? ' textLength="116" lengthAdjust="spacingAndGlyphs"'
    : "";
}

function fittedProjectAttributes(project: string): string {
  return estimatedEmWidth(project) * 12 > 62
    ? ' textLength="62" lengthAdjust="spacingAndGlyphs"'
    : "";
}

export function agentSvg(
  slot: number,
  status: AgentStatus,
  thread?: AgentVisualThread,
): string {
  const color = STATUS_COLORS[status];
  const project = thread ? projectName(thread.cwd) : "CODEX";
  const title =
    thread?.title || (status === "error" ? "Codex offline" : "Empty slot");
  const titleLines = chatTitleLines(title);
  const firstTitleY =
    titleLines.length === 1 ? 91 : titleLines.length === 2 ? 80 : 68;
  const titleRows = titleLines
    .map(
      (line, index) =>
        `<text x="72" y="${firstTitleY + index * 23}" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="750" font-size="21"${fittedTitleAttributes(line)} text-anchor="middle">${escapeXml(line)}</text>`,
    )
    .join("\n      ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${LUCIDE_LICENSE}
    ${keyShell()}
    <rect x="12" y="12" width="120" height="36" rx="12" fill="#FFFFFF" opacity=".07"/>
    ${lucideGlyph(AGENT_STATUS_ICON_SOURCES[status], {
      center: [28, 30],
      color,
      size: 20,
      strokeWidth: 2.5,
    })}
    <text x="42" y="35" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="800" font-size="15">${slot}</text>
    <text x="124" y="34" fill="#9AA6B2" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-weight="700" font-size="12"${fittedProjectAttributes(project)} text-anchor="end">${escapeXml(project)}</text>
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
