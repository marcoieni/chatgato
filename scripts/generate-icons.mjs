import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { actionListIcons } from "./action-list-icons.mjs";
import {
  actionIconSources,
  keyGlyph,
  LUCIDE_LICENSE,
  lucideGlyph,
  reasoningIconSources,
} from "./lucide-icons.mjs";

const pluginRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../com.marco.chatgato.sdPlugin",
);
const actionRoot = join(pluginRoot, "imgs/actions");
const actionListRoot = join(pluginRoot, "imgs/action-list");

const colors = {
  background: "#071018",
  blue: "#304FFE",
  green: "#00FF4C",
  ink: "#071018",
  orange: "#FF6D00",
  purple: "#9E5BFF",
  red: "#FF0033",
  slate: "#303840",
  white: "#FFFFFF",
};

const shell = `<rect width="144" height="144" rx="24" fill="${colors.background}"/>
  <rect x="8" y="8" width="128" height="128" rx="20" fill="none" stroke="${colors.white}" stroke-opacity=".12" stroke-width="2"/>`;
const gradient = `<defs><linearGradient id="reasoning-gradient" x1="0" y1="1" x2="1" y2="0"><stop stop-color="${colors.blue}"/><stop offset="1" stop-color="${colors.purple}"/></linearGradient></defs>`;

function keySvg(
  accent,
  glyph,
  { defs = "", glyphCenter = [72, 54], usesLucide = true } = {},
) {
  const [sourceX, sourceY] = glyphCenter;
  const translateX = 72 - sourceX;
  const translateY = 54 - sourceY;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  ${usesLucide ? `${LUCIDE_LICENSE}\n  ` : ""}${defs}${shell}
  <rect x="28" y="14" width="88" height="80" rx="22" fill="${accent}"/>
  <g data-source-center="${sourceX} ${sourceY}" data-glyph-center="72 54" transform="translate(${translateX} ${translateY})">
    ${glyph}
  </g>
</svg>\n`;
}

function rawKeySvg(content, { usesLucide = false } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  ${usesLucide ? `${LUCIDE_LICENSE}\n  ` : ""}${content}
</svg>\n`;
}

const actionStyles = {
  agent: { accent: colors.blue },
  approve: { accent: colors.slate, color: colors.green, size: 64 },
  decline: { accent: colors.slate, color: colors.red, size: 64 },
  fast: { accent: colors.slate },
  "go-back": { accent: colors.blue },
  "go-forward": { accent: colors.blue },
  "new-chat": { accent: colors.slate },
  "open-review": { accent: colors.orange },
  plan: { accent: colors.slate },
  prompt: { accent: colors.purple },
  "push-to-talk": { accent: colors.slate },
  "review-tab": { accent: colors.blue },
  scheduled: { accent: colors.blue },
  settings: { accent: colors.slate },
  skills: { accent: colors.purple },
  submit: { accent: colors.slate },
  terminal: { accent: colors.slate, color: colors.white },
  "toggle-sidebar": { accent: colors.blue },
};

const actionIcons = Object.fromEntries(
  Object.entries(actionStyles).map(([name, style]) => [
    name,
    keySvg(
      style.accent,
      keyGlyph(actionIconSources[name], {
        color: style.color ?? colors.white,
        size: style.size ?? 60,
      }),
    ),
  ]),
);

actionIcons.agent = keySvg(
  colors.blue,
  `${keyGlyph(actionIconSources.agent, { size: 58 })}
  <circle cx="101" cy="29" r="11" fill="${colors.white}"/>
  <text x="101" y="33" fill="${colors.blue}" font-family="Arial,sans-serif" font-size="12" font-weight="800" text-anchor="middle">1</text>`,
);
actionIcons.fork = keySvg(
  colors.slate,
  `<path d="M41 54h20l24-24M69 30h16v16M69 62l16 16M69 78h16V62" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  { glyphCenter: [63, 54], usesLucide: false },
);

const reasoningKeyIcon = (direction) =>
  keySvg(
    "url(#reasoning-gradient)",
    `${lucideGlyph(reasoningIconSources.brain, {
      center: [62, 54],
      size: 48,
    })}
    ${lucideGlyph(reasoningIconSources[direction], {
      center: [99, 54],
      size: 24,
    })}`,
    { defs: gradient },
  );

actionIcons["reasoning-decrease"] = reasoningKeyIcon("decrease");
actionIcons["reasoning-increase"] = reasoningKeyIcon("increase");
actionIcons.reasoning = rawKeySvg(
  `${gradient}${shell}
  <rect x="25" y="22" width="94" height="100" rx="25" fill="url(#reasoning-gradient)"/>
  ${lucideGlyph(actionIconSources.reasoning, {
    center: [72, 72],
    size: 64,
  })}`,
  { usesLucide: true },
);
actionIcons.usage = rawKeySvg(`${shell}
  <text x="18" y="32" fill="${colors.white}" font-family="Arial,sans-serif" font-size="18" font-weight="800">5H</text>
  <text x="126" y="32" fill="${colors.green}" font-family="Arial,sans-serif" font-size="28" font-weight="800" text-anchor="end">75%</text>
  <text x="126" y="45" fill="#9AA6B2" font-family="Arial,sans-serif" font-size="9" font-weight="700" text-anchor="end">RESET 2H 14M</text>
  <rect x="18" y="51" width="108" height="8" rx="4" fill="${colors.slate}"/><rect x="18" y="51" width="81" height="8" rx="4" fill="${colors.green}"/>
  <text x="18" y="80" fill="${colors.white}" font-family="Arial,sans-serif" font-size="18" font-weight="800">1W</text>
  <text x="126" y="80" fill="${colors.blue}" font-family="Arial,sans-serif" font-size="28" font-weight="800" text-anchor="end">50%</text>
  <text x="126" y="93" fill="#9AA6B2" font-family="Arial,sans-serif" font-size="9" font-weight="700" text-anchor="end">RESET 3D 8H</text>
  <rect x="18" y="99" width="108" height="8" rx="4" fill="${colors.slate}"/><rect x="18" y="99" width="54" height="8" rx="4" fill="${colors.blue}"/>
  <rect x="27" y="116" width="90" height="17" rx="8.5" fill="${colors.purple}" fill-opacity=".2" stroke="${colors.purple}" stroke-opacity=".7"/>
  <text x="72" y="128" fill="${colors.purple}" font-family="Arial,sans-serif" font-size="8" font-weight="800" text-anchor="middle">RESET ×2</text>`);
actionIcons["usage-statistics"] = rawKeySvg(`${shell}
  <text x="16" y="23" fill="#9AA6B2" font-family="Arial,sans-serif" font-size="10" font-weight="800">LIFETIME TOKENS</text>
  <text x="128" y="54" fill="${colors.white}" font-family="Arial,sans-serif" font-size="30" font-weight="800" text-anchor="end">12.4M</text>
  ${[8, 14, 11, 22, 18, 30, 25]
    .map(
      (height, index) =>
        `<rect x="${16 + index * 16}" y="${99 - height}" width="12" height="${height}" rx="3" fill="${index === 6 ? colors.green : colors.blue}"/>`,
    )
    .join("\n  ")}
  <text x="16" y="110" fill="#9AA6B2" font-family="Arial,sans-serif" font-size="9" font-weight="800">DAILY</text>
  <text x="128" y="110" fill="${colors.purple}" font-family="Arial,sans-serif" font-size="9" font-weight="800" text-anchor="end">PEAK 482K</text>
  <text x="16" y="128" fill="${colors.green}" font-family="Arial,sans-serif" font-size="9" font-weight="800">STREAK 7/21D</text>
  <text x="128" y="128" fill="${colors.blue}" font-family="Arial,sans-serif" font-size="9" font-weight="800" text-anchor="end">TURN 18M</text>`);

const reasoningBackground = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">
  <defs><linearGradient id="reasoning-gradient" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${colors.blue}"/><stop offset="1" stop-color="${colors.purple}"/></linearGradient></defs>
  <rect width="200" height="100" rx="18" fill="${colors.background}"/>
  <rect x="8" y="8" width="184" height="84" rx="14" fill="url(#reasoning-gradient)" opacity=".35"/>
  <rect x="8" y="8" width="184" height="84" rx="14" fill="none" stroke="${colors.white}" stroke-opacity=".12" stroke-width="2"/>
</svg>\n`;

await Promise.all([
  ...Object.entries(actionIcons).map(([name, svg]) =>
    writeFile(join(actionRoot, `${name}.svg`), svg),
  ),
  ...Object.entries(actionListIcons).map(([name, svg]) =>
    writeFile(join(actionListRoot, `${name}.svg`), svg),
  ),
  writeFile(join(actionRoot, "reasoning-background.svg"), reasoningBackground),
]);
