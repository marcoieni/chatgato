import { basename } from "node:path";
import { remainingPercent, usageWindowLabel } from "./codex-usage.js";
import type { AgentStatus, CodexThread, CodexUsageSnapshot } from "../types.js";

// Status colors used by ChatGato actions.
export const STATUS_COLORS: Record<AgentStatus, string> = {
  off: "#000000",
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

export const PUSH_TO_TALK_COLORS = {
  idle: "#071018",
  active: "#FFD600",
} as const;

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
  const darkText = status === "idle" || status === "unread" || status === "awaiting-approval";
  const foreground = darkText ? "#071018" : "#FFFFFF";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="24" fill="${color}"/>
    <rect x="8" y="8" width="128" height="128" rx="20" fill="none" stroke="${foreground}" stroke-opacity=".18" stroke-width="2"/>
    <path d="M46 53h52v38H46z" fill="none" stroke="${foreground}" stroke-width="7" stroke-linejoin="round"/>
    <path d="M58 68l9 8-9 8M76 84h12" fill="none" stroke="${foreground}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="118" cy="26" r="10" fill="${foreground}" opacity=".9"/>
    <text x="118" y="31" fill="${color}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="14" text-anchor="middle">${slot}</text>
  </svg>`;
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function agentImage(slot: number, status: AgentStatus): string {
  return svgDataUri(agentSvg(slot, status));
}

export function emptyAgentSvg(slot: number): string {
  return agentSvg(slot, "off");
}

export function keyTitle(thread: CodexThread, status: AgentStatus): string {
  const project = basename(thread.cwd) || "Codex";
  const compactProject = project.length > 10 ? `${project.slice(0, 9)}…` : project;
  return `${STATUS_LABELS[status]}\n${compactProject}`;
}

export function reasoningSvg(direction: "increase" | "decrease" = "increase"): string {
  const arrow = direction === "increase" ? "↑" : "↓";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#304FFE"/><stop offset="1" stop-color="#9E5BFF"/></linearGradient></defs>
    <rect width="144" height="144" rx="24" fill="#071018"/>
    <path d="M45 72c-12-8-8-28 7-30 3-15 26-18 34-5 15-5 29 10 23 24 15 8 10 31-7 33-5 15-28 16-35 3-17 5-31-10-22-25z" fill="url(#g)"/>
    <text x="72" y="90" fill="#fff" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="54" text-anchor="middle">${arrow}</text>
  </svg>`;
}

export function fastModeSvg(enabled: boolean): string {
  const color = enabled ? FAST_MODE_COLORS.on : FAST_MODE_COLORS.off;
  const foreground = enabled ? "#071018" : "#FFFFFF";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="24" fill="${color}"/>
    <rect x="8" y="8" width="128" height="128" rx="20" fill="none" stroke="${foreground}" stroke-opacity=".18" stroke-width="2"/>
    <path d="M78 20 42 78h25l-7 46 42-65H76z" fill="${foreground}"/>
  </svg>`;
}

export function fastModeImage(enabled: boolean): string {
  return svgDataUri(fastModeSvg(enabled));
}

export function pushToTalkSvg(active: boolean): string {
  const color = active ? PUSH_TO_TALK_COLORS.active : PUSH_TO_TALK_COLORS.idle;
  const foreground = active ? "#071018" : "#FFFFFF";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    <rect width="144" height="144" rx="24" fill="${color}"/>
    <rect x="8" y="8" width="128" height="128" rx="20" fill="none" stroke="${foreground}" stroke-opacity=".18" stroke-width="2"/>
    <rect x="51" y="18" width="42" height="68" rx="21" fill="none" stroke="${foreground}" stroke-width="9"/>
    <path d="M34 66v5c0 21 17 38 38 38s38-17 38-38v-5M72 109v17M53 126h38" fill="none" stroke="${foreground}" stroke-width="9" stroke-linecap="round"/>
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

export function usageSvg(usage: CodexUsageSnapshot | null, failed = false): string {
  const shell = `<rect width="144" height="144" rx="24" fill="#071018"/>
    <rect x="8" y="8" width="128" height="128" rx="20" fill="none" stroke="#FFFFFF" stroke-opacity=".12" stroke-width="2"/>`;
  if (failed) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
      ${shell}
      <text x="72" y="62" fill="#FF0033" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="18" text-anchor="middle">USAGE</text>
      <text x="72" y="86" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="700" font-size="15" text-anchor="middle">OFFLINE</text>
    </svg>`;
  }

  const windows = usage ? [usage.primary, usage.secondary].filter((window) => window !== null) : [];
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

  const rows = windows.slice(0, 2).map((window, index) => {
    const remaining = remainingPercent(window);
    const color = usageColor(remaining);
    const y = windows.length === 1 ? 66 : 50 + index * 45;
    const width = Math.round(104 * remaining / 100);
    return `<text x="20" y="${y}" fill="#9AA6B2" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="14">${usageWindowLabel(window.windowMinutes)}</text>
      <text x="124" y="${y}" fill="${color}" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="21" text-anchor="end">${remaining}%</text>
      <rect x="20" y="${y + 8}" width="104" height="7" rx="3.5" fill="#303840"/>
      <rect x="20" y="${y + 8}" width="${width}" height="7" rx="3.5" fill="${color}"/>`;
  }).join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
    ${shell}
    <text x="72" y="24" fill="#FFFFFF" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-weight="800" font-size="12" letter-spacing="1.5" text-anchor="middle">LEFT</text>
    ${rows}
  </svg>`;
}

export function usageImage(usage: CodexUsageSnapshot | null, failed = false): string {
  return svgDataUri(usageSvg(usage, failed));
}
