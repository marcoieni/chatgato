import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { actionListIcons } from "./action-list-icons.mjs";

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

const keyGlyphCenter = [72, 54];

function keySvg(
  accent,
  glyph,
  { defs = "", glyphCenter = keyGlyphCenter } = {},
) {
  const [sourceX, sourceY] = glyphCenter;
  const [targetX, targetY] = keyGlyphCenter;
  const translateX = targetX - sourceX;
  const translateY = targetY - sourceY;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  ${defs}${shell}
  <rect x="28" y="14" width="88" height="80" rx="22" fill="${accent}"/>
  <g data-source-center="${sourceX} ${sourceY}" data-glyph-center="${targetX} ${targetY}" transform="translate(${translateX} ${translateY})">
    ${glyph}
  </g>
</svg>\n`;
}

function rawKeySvg(content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  ${content}
</svg>\n`;
}

const actionIcons = {
  agent: keySvg(
    colors.blue,
    `<rect x="46" y="31" width="52" height="38" rx="6" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="M58 45l9 8-9 8M76 61h11" fill="none" stroke="${colors.white}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="101" cy="29" r="11" fill="${colors.white}"/>
  <text x="101" y="33" fill="${colors.blue}" font-family="Arial,sans-serif" font-size="12" font-weight="800" text-anchor="middle">1</text>`,
    { glyphCenter: [77.25, 45.25] },
  ),
  approve: keySvg(
    colors.green,
    `<path d="M48 56l15 15 33-36" fill="none" stroke="${colors.ink}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`,
    { glyphCenter: [72, 53] },
  ),
  decline: keySvg(
    colors.red,
    `<path d="M51 37l42 42M93 37 51 79" fill="none" stroke="${colors.white}" stroke-width="10" stroke-linecap="round"/>`,
    { glyphCenter: [72, 58] },
  ),
  fast: keySvg(
    colors.slate,
    `<path d="M78 23 48 62h21l-4 29 31-45H76z" fill="${colors.white}"/>`,
    { glyphCenter: [72, 57] },
  ),
  fork: keySvg(
    colors.purple,
    `<path d="M41 54h20l24-24M69 30h16v16M69 62l16 16M69 78h16V62" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
    { glyphCenter: [63, 54] },
  ),
  "go-back": keySvg(
    colors.blue,
    `<path d="M78 33 54 57l24 24M55 57h38" fill="none" stroke="${colors.white}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,
    { glyphCenter: [73.5, 57] },
  ),
  "go-forward": keySvg(
    colors.blue,
    `<path d="m66 33 24 24-24 24m23-24H51" fill="none" stroke="${colors.white}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,
    { glyphCenter: [70.5, 57] },
  ),
  "new-task": keySvg(
    colors.blue,
    `<path d="M72 33v44M50 55h44" fill="none" stroke="${colors.white}" stroke-width="9" stroke-linecap="round"/>`,
    { glyphCenter: [72, 55] },
  ),
  "open-review": keySvg(
    colors.orange,
    `<path d="M47 33h40M47 46h27" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round"/>
  <circle cx="66" cy="65" r="14" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="m77 76 13 13" fill="none" stroke="${colors.white}" stroke-width="8" stroke-linecap="round"/>`,
    { glyphCenter: [68.75, 61.25] },
  ),
  plan: keySvg(
    colors.slate,
    `<path d="m46 40 6 6 10-12m-16 31 6 6 10-12M72 40h25M72 65h25" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
    { glyphCenter: [71.5, 52.5] },
  ),
  prompt: keySvg(
    colors.purple,
    `<path d="M46 32h41a9 9 0 0 1 9 9v21a9 9 0 0 1-9 9H69L55 82V71h-9a9 9 0 0 1-9-9V41a9 9 0 0 1 9-9z" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linejoin="round"/>
  <path d="m96 23 3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="${colors.green}"/>`,
    { glyphCenter: [70.25, 54.25] },
  ),
  "push-to-talk": keySvg(
    colors.slate,
    `<rect x="59" y="25" width="26" height="39" rx="13" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="M48 58v4c0 13 11 23 24 23s24-10 24-23v-4M72 85v8M60 93h24" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round"/>`,
    { glyphCenter: [72, 59] },
  ),
  "reasoning-decrease": keySvg(
    "url(#reasoning-gradient)",
    `<path d="M49 66c-8-5-5-17 4-18 2-11 18-13 24-4 11-3 20 9 14 18 9 5 5 19-6 19H58c-10 0-16-9-9-15z" fill="none" stroke="${colors.white}" stroke-opacity=".45" stroke-width="5"/>
  <path d="M72 38v38m-13-13 13 13 13-13" fill="none" stroke="${colors.white}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
    { defs: gradient, glyphCenter: [70.25, 58.75] },
  ),
  "reasoning-increase": keySvg(
    "url(#reasoning-gradient)",
    `<path d="M49 66c-8-5-5-17 4-18 2-11 18-13 24-4 11-3 20 9 14 18 9 5 5 19-6 19H58c-10 0-16-9-9-15z" fill="none" stroke="${colors.white}" stroke-opacity=".45" stroke-width="5"/>
  <path d="M72 78V40M59 53l13-13 13 13" fill="none" stroke="${colors.white}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
    { defs: gradient, glyphCenter: [70.25, 59.75] },
  ),
  reasoning: rawKeySvg(`${gradient}${shell}
  <rect x="25" y="22" width="94" height="100" rx="25" fill="url(#reasoning-gradient)"/>
  <path d="M54 88V54M43 65l11-11 11 11m25-9v34M79 79l11 11 11-11" fill="none" stroke="${colors.white}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`),
  "review-tab": keySvg(
    colors.blue,
    `<rect x="42" y="27" width="60" height="58" rx="8" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="M43 44h58M54 62l8 8 15-18M83 59h9M83 71h9" fill="none" stroke="${colors.white}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
    { glyphCenter: [72, 56] },
  ),
  scheduled: keySvg(
    colors.blue,
    `<rect x="42" y="30" width="60" height="52" rx="8" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="M43 47h58M57 25v12M87 25v12" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round"/>
  <circle cx="86" cy="69" r="15" fill="${colors.orange}"/>
  <path d="M86 60v10l7 5" fill="none" stroke="${colors.white}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
    { glyphCenter: [72, 53.5] },
  ),
  settings: keySvg(
    colors.slate,
    `<path d="M46 37h52M46 56h52M46 75h52" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round"/>
  <circle cx="62" cy="37" r="7" fill="${colors.slate}" stroke="${colors.white}" stroke-width="6"/>
  <circle cx="84" cy="56" r="7" fill="${colors.slate}" stroke="${colors.white}" stroke-width="6"/>
  <circle cx="66" cy="75" r="7" fill="${colors.slate}" stroke="${colors.white}" stroke-width="6"/>`,
    { glyphCenter: [72, 56] },
  ),
  skills: keySvg(
    colors.purple,
    `<path d="m49 80 35-35" fill="none" stroke="${colors.white}" stroke-width="9" stroke-linecap="round"/>
  <path d="m92 24 3 9 9 3-9 3-3 9-3-9-9-3 9-3zm-45 18 2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="${colors.green}"/>`,
    { glyphCenter: [72, 54.25] },
  ),
  submit: keySvg(
    colors.green,
    `<path d="M72 80V37M52 57l20-20 20 20" fill="none" stroke="${colors.ink}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`,
    { glyphCenter: [72, 58.5] },
  ),
  terminal: keySvg(
    colors.slate,
    `<rect x="40" y="28" width="64" height="56" rx="9" fill="none" stroke="${colors.white}" stroke-width="6"/>
  <path d="m51 46 11 11-11 11m22 0h19" fill="none" stroke="${colors.green}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
    { glyphCenter: [72, 56] },
  ),
  "toggle-sidebar": keySvg(
    colors.blue,
    `<rect x="42" y="27" width="60" height="58" rx="8" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="M63 29v54M52 48l-7 8 7 8m-7-8h12M76 43h15M76 56h15M76 69h10" fill="none" stroke="${colors.white}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
    { glyphCenter: [72, 56] },
  ),
  usage: rawKeySvg(`${shell}
  <text x="18" y="48" fill="${colors.white}" font-family="Arial,sans-serif" font-size="20" font-weight="800">5H</text>
  <text x="126" y="48" fill="${colors.green}" font-family="Arial,sans-serif" font-size="32" font-weight="800" text-anchor="end">75%</text>
  <rect x="18" y="57" width="108" height="9" rx="4.5" fill="${colors.slate}"/><rect x="18" y="57" width="81" height="9" rx="4.5" fill="${colors.green}"/>
  <text x="18" y="102" fill="${colors.white}" font-family="Arial,sans-serif" font-size="20" font-weight="800">1W</text>
  <text x="126" y="102" fill="${colors.blue}" font-family="Arial,sans-serif" font-size="32" font-weight="800" text-anchor="end">50%</text>
  <rect x="18" y="111" width="108" height="9" rx="4.5" fill="${colors.slate}"/><rect x="18" y="111" width="54" height="9" rx="4.5" fill="${colors.blue}"/>`),
};

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
