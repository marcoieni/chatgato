import ArrowDown from "lucide-static/dist/esm/icons/arrow-down.mjs";
import ArrowLeft from "lucide-static/dist/esm/icons/arrow-left.mjs";
import ArrowRight from "lucide-static/dist/esm/icons/arrow-right.mjs";
import ArrowUp from "lucide-static/dist/esm/icons/arrow-up.mjs";
import Bot from "lucide-static/dist/esm/icons/bot.mjs";
import Brain from "lucide-static/dist/esm/icons/brain.mjs";
import BrainCog from "lucide-static/dist/esm/icons/brain-cog.mjs";
import CalendarClock from "lucide-static/dist/esm/icons/calendar-clock.mjs";
import ChartBar from "lucide-static/dist/esm/icons/chart-bar.mjs";
import Check from "lucide-static/dist/esm/icons/check.mjs";
import CircleArrowUp from "lucide-static/dist/esm/icons/circle-arrow-up.mjs";
import Lightbulb from "lucide-static/dist/esm/icons/lightbulb.mjs";
import ListChecks from "lucide-static/dist/esm/icons/list-checks.mjs";
import MessageSquarePlus from "lucide-static/dist/esm/icons/message-square-plus.mjs";
import Mic from "lucide-static/dist/esm/icons/mic.mjs";
import PanelLeft from "lucide-static/dist/esm/icons/panel-left.mjs";
import ScanSearch from "lucide-static/dist/esm/icons/scan-search.mjs";
import SlidersHorizontal from "lucide-static/dist/esm/icons/sliders-horizontal.mjs";
import SquarePlus from "lucide-static/dist/esm/icons/square-plus.mjs";
import SquareTerminal from "lucide-static/dist/esm/icons/square-terminal.mjs";
import WandSparkles from "lucide-static/dist/esm/icons/wand-sparkles.mjs";
import X from "lucide-static/dist/esm/icons/x.mjs";
import Zap from "lucide-static/dist/esm/icons/zap.mjs";

export const LUCIDE_LICENSE =
  "<!-- Icons: Lucide v1.27.0, ISC license. See LICENSES/Lucide.txt. -->";

export const actionIconSources = {
  agent: Bot,
  approve: Check,
  decline: X,
  fast: Zap,
  "go-back": ArrowLeft,
  "go-forward": ArrowRight,
  "new-task": SquarePlus,
  "open-review": ScanSearch,
  plan: Lightbulb,
  prompt: MessageSquarePlus,
  "push-to-talk": Mic,
  reasoning: BrainCog,
  "review-tab": ListChecks,
  scheduled: CalendarClock,
  settings: SlidersHorizontal,
  skills: WandSparkles,
  submit: CircleArrowUp,
  terminal: SquareTerminal,
  "toggle-sidebar": PanelLeft,
  usage: ChartBar,
};

export const reasoningIconSources = {
  brain: Brain,
  decrease: ArrowDown,
  increase: ArrowUp,
};

function sourceParts(source) {
  const name = source.match(/\blucide-([a-z0-9-]+)"/)?.[1];
  const content = source.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/)?.[1]?.trim();

  if (!name || !content) {
    throw new Error("Invalid Lucide SVG source");
  }

  return { content, name };
}

export function lucideGlyph(
  source,
  { center = [72, 54], color = "#FFFFFF", size = 60, strokeWidth = 2 } = {},
) {
  const { content, name } = sourceParts(source);
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

export function keyGlyph(source, options = {}) {
  return lucideGlyph(source, {
    center: [72, 54],
    size: 60,
    ...options,
  });
}

export function listGlyph(source, options = {}) {
  return lucideGlyph(source, {
    center: [10, 10],
    size: 18,
    ...options,
  });
}
