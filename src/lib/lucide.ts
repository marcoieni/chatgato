import ArrowDown from "lucide-static/dist/esm/icons/arrow-down.mjs";
import ArrowUp from "lucide-static/dist/esm/icons/arrow-up.mjs";
import Brain from "lucide-static/dist/esm/icons/brain.mjs";
import CircleDashed from "lucide-static/dist/esm/icons/circle-dashed.mjs";
import Lightbulb from "lucide-static/dist/esm/icons/lightbulb.mjs";
import MessageCircleQuestion from "lucide-static/dist/esm/icons/message-circle-question-mark.mjs";
import Mic from "lucide-static/dist/esm/icons/mic.mjs";
import Power from "lucide-static/dist/esm/icons/power.mjs";
import ShieldCheck from "lucide-static/dist/esm/icons/shield-check.mjs";
import X from "lucide-static/dist/esm/icons/x.mjs";
import Zap from "lucide-static/dist/esm/icons/zap.mjs";
import type { AgentStatus } from "../types.js";

export const LUCIDE_LICENSE =
  "<!-- Icons: Lucide v1.27.0, ISC license. See LICENSES/Lucide.txt. -->";

export const DYNAMIC_ICON_SOURCES = {
  brain: Brain,
  decrease: ArrowDown,
  fast: Zap,
  increase: ArrowUp,
  plan: Lightbulb,
  pushToTalk: Mic,
} as const;

export const AGENT_STATUS_ICON_SOURCES: Partial<Record<AgentStatus, string>> = {
  off: Power,
  working: CircleDashed,
  "awaiting-approval": ShieldCheck,
  "awaiting-response": MessageCircleQuestion,
  error: X,
};

interface LucideGlyphOptions {
  center?: readonly [number, number];
  color?: string;
  size?: number;
  strokeWidth?: number;
}

export function lucideGlyph(
  source: string,
  {
    center = [72, 54],
    color = "#FFFFFF",
    size = 60,
    strokeWidth = 2,
  }: LucideGlyphOptions = {},
): string {
  const name = source.match(/\blucide-([a-z0-9-]+)"/)?.[1];
  const content = source.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1]?.trim();

  if (!name || !content) {
    throw new Error("Invalid Lucide SVG source");
  }

  const [centerX, centerY] = center;
  const scale = size / 24;
  const x = centerX - size / 2;
  const y = centerY - size / 2;
  const transform = `matrix(${scale} 0 0 ${scale} ${x} ${y})`;
  const attributes = ` transform="${transform}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
  const styledContent = content.replace(
    /<(path|circle|rect|line|polyline|polygon|ellipse)\b/g,
    `<$1${attributes}`,
  );

  return `<g data-lucide-icon="${name}">
      ${styledContent}
    </g>`;
}
