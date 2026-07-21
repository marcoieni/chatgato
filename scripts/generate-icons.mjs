import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function keySvg(accent, glyph, { defs = "" } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  ${defs}${shell}
  <rect x="28" y="14" width="88" height="80" rx="22" fill="${accent}"/>
  ${glyph}
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
  ),
  approve: keySvg(
    colors.green,
    `<path d="M48 56l15 15 33-36" fill="none" stroke="${colors.ink}" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  decline: keySvg(
    colors.red,
    `<path d="M51 37l42 42M93 37 51 79" fill="none" stroke="${colors.white}" stroke-width="10" stroke-linecap="round"/>`,
  ),
  fast: keySvg(
    colors.slate,
    `<path d="M78 23 48 62h21l-4 29 31-45H76z" fill="${colors.white}"/>`,
  ),
  fork: keySvg(
    colors.purple,
    `<path d="M50 36v9c0 8 4 12 11 16l11 6m22-31v9c0 8-4 12-11 16l-11 6v14" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="50" cy="31" r="7" fill="${colors.white}"/><circle cx="94" cy="31" r="7" fill="${colors.white}"/><circle cx="72" cy="84" r="7" fill="${colors.white}"/>`,
  ),
  "go-back": keySvg(
    colors.blue,
    `<path d="M78 33 54 57l24 24M55 57h38" fill="none" stroke="${colors.white}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  "go-forward": keySvg(
    colors.blue,
    `<path d="m66 33 24 24-24 24m23-24H51" fill="none" stroke="${colors.white}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  "new-task": keySvg(
    colors.blue,
    `<rect x="47" y="26" width="50" height="60" rx="9" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="M72 41v30M57 56h30" fill="none" stroke="${colors.white}" stroke-width="8" stroke-linecap="round"/>`,
  ),
  "open-review": keySvg(
    colors.orange,
    `<path d="M47 33h40M47 46h27" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round"/>
  <circle cx="66" cy="65" r="14" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="m77 76 13 13" fill="none" stroke="${colors.white}" stroke-width="8" stroke-linecap="round"/>`,
  ),
  plan: keySvg(
    colors.slate,
    `<path d="m46 40 6 6 10-12m-16 31 6 6 10-12M72 40h25M72 65h25" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  prompt: keySvg(
    colors.purple,
    `<path d="M46 32h41a9 9 0 0 1 9 9v21a9 9 0 0 1-9 9H69L55 82V71h-9a9 9 0 0 1-9-9V41a9 9 0 0 1 9-9z" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linejoin="round"/>
  <path d="m96 23 3 8 8 3-8 3-3 8-3-8-8-3 8-3z" fill="${colors.green}"/>`,
  ),
  "push-to-talk": keySvg(
    colors.slate,
    `<rect x="59" y="25" width="26" height="39" rx="13" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="M48 58v4c0 13 11 23 24 23s24-10 24-23v-4M72 85v8M60 93h24" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round"/>`,
  ),
  "reasoning-decrease": keySvg(
    "url(#reasoning-gradient)",
    `<path d="M49 66c-8-5-5-17 4-18 2-11 18-13 24-4 11-3 20 9 14 18 9 5 5 19-6 19H58c-10 0-16-9-9-15z" fill="none" stroke="${colors.white}" stroke-opacity=".45" stroke-width="5"/>
  <path d="M72 38v38m-13-13 13 13 13-13" fill="none" stroke="${colors.white}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
    { defs: gradient },
  ),
  "reasoning-increase": keySvg(
    "url(#reasoning-gradient)",
    `<path d="M49 66c-8-5-5-17 4-18 2-11 18-13 24-4 11-3 20 9 14 18 9 5 5 19-6 19H58c-10 0-16-9-9-15z" fill="none" stroke="${colors.white}" stroke-opacity=".45" stroke-width="5"/>
  <path d="M72 78V40M59 53l13-13 13 13" fill="none" stroke="${colors.white}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`,
    { defs: gradient },
  ),
  reasoning: rawKeySvg(`${gradient}${shell}
  <rect x="25" y="22" width="94" height="100" rx="25" fill="url(#reasoning-gradient)"/>
  <path d="M54 88V54M43 65l11-11 11 11m25-9v34M79 79l11 11 11-11" fill="none" stroke="${colors.white}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`),
  "review-tab": keySvg(
    colors.blue,
    `<rect x="42" y="27" width="60" height="58" rx="8" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="M43 44h58M54 62l8 8 15-18M83 59h9M83 71h9" fill="none" stroke="${colors.white}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  scheduled: keySvg(
    colors.blue,
    `<rect x="42" y="30" width="60" height="52" rx="8" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="M43 47h58M57 25v12M87 25v12" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round"/>
  <circle cx="86" cy="69" r="15" fill="${colors.orange}"/>
  <path d="M86 60v10l7 5" fill="none" stroke="${colors.white}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  settings: keySvg(
    colors.slate,
    `<path d="M46 37h52M46 56h52M46 75h52" fill="none" stroke="${colors.white}" stroke-width="7" stroke-linecap="round"/>
  <circle cx="62" cy="37" r="7" fill="${colors.slate}" stroke="${colors.white}" stroke-width="6"/>
  <circle cx="84" cy="56" r="7" fill="${colors.slate}" stroke="${colors.white}" stroke-width="6"/>
  <circle cx="66" cy="75" r="7" fill="${colors.slate}" stroke="${colors.white}" stroke-width="6"/>`,
  ),
  skills: keySvg(
    colors.purple,
    `<path d="m49 80 35-35" fill="none" stroke="${colors.white}" stroke-width="9" stroke-linecap="round"/>
  <path d="m92 24 3 9 9 3-9 3-3 9-3-9-9-3 9-3zm-45 18 2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="${colors.green}"/>`,
  ),
  submit: keySvg(
    colors.green,
    `<path d="M72 80V37M52 57l20-20 20 20" fill="none" stroke="${colors.ink}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  terminal: keySvg(
    colors.slate,
    `<rect x="40" y="28" width="64" height="56" rx="9" fill="none" stroke="${colors.white}" stroke-width="6"/>
  <path d="m51 46 11 11-11 11m22 0h19" fill="none" stroke="${colors.green}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  "toggle-sidebar": keySvg(
    colors.blue,
    `<rect x="42" y="27" width="60" height="58" rx="8" fill="none" stroke="${colors.white}" stroke-width="7"/>
  <path d="M63 29v54M52 48l-7 8 7 8m-7-8h12M76 43h15M76 56h15M76 69h10" fill="none" stroke="${colors.white}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  usage: rawKeySvg(`${shell}
  <text x="72" y="31" fill="${colors.white}" font-family="Arial,sans-serif" font-size="12" font-weight="800" letter-spacing="1.5" text-anchor="middle">LEFT</text>
  <text x="20" y="57" fill="#9AA6B2" font-family="Arial,sans-serif" font-size="13" font-weight="800">5H</text>
  <text x="124" y="57" fill="${colors.green}" font-family="Arial,sans-serif" font-size="20" font-weight="800" text-anchor="end">75%</text>
  <rect x="20" y="65" width="104" height="7" rx="3.5" fill="${colors.slate}"/><rect x="20" y="65" width="78" height="7" rx="3.5" fill="${colors.green}"/>
  <text x="20" y="99" fill="#9AA6B2" font-family="Arial,sans-serif" font-size="13" font-weight="800">1W</text>
  <text x="124" y="99" fill="${colors.blue}" font-family="Arial,sans-serif" font-size="20" font-weight="800" text-anchor="end">50%</text>
  <rect x="20" y="107" width="104" height="7" rx="3.5" fill="${colors.slate}"/><rect x="20" y="107" width="52" height="7" rx="3.5" fill="${colors.blue}"/>`),
};

const list = (content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  ${content}
</svg>\n`;
const line = (content, width = 1.75) =>
  `<g fill="none" stroke="#FFFFFF" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${content}</g>`;

const actionListIcons = {
  agent: list(
    line(
      `<rect x="2.5" y="3.5" width="15" height="12.5" rx="2"/><path d="m6 8 2 2-2 2m4.5 0h3"/>`,
    ),
  ),
  approve: list(line(`<path d="m3 10 4 4L17 4"/>`, 2.25)),
  decline: list(line(`<path d="m4 4 12 12M16 4 4 16"/>`, 2.25)),
  fast: list(line(`<path d="m11 1.75-6 9h4l-1 7.5 7-10h-4.25z"/>`)),
  fork: list(
    line(
      `<path d="M5 5v2.25c0 1 .55 1.85 1.4 2.3l3.6 1.95m5-6.5v2.25c0 1-.55 1.85-1.4 2.3L10 11.5V15"/><circle cx="5" cy="3.25" r="1.75"/><circle cx="15" cy="3.25" r="1.75"/><circle cx="10" cy="16.75" r="1.75"/>`,
    ),
  ),
  "go-back": list(line(`<path d="m8 4-6 6 6 6m-5.5-6H18"/>`, 2)),
  "go-forward": list(line(`<path d="m12 4 6 6-6 6m5.5-6H2"/>`, 2)),
  "new-task": list(
    line(
      `<rect x="2.5" y="2.5" width="15" height="15" rx="2.5"/><path d="M10 6v8m-4-4h8"/>`,
    ),
  ),
  "open-review": list(
    line(
      `<path d="M4 2.5h10v4m-10-1h6"/><circle cx="10" cy="11.5" r="4"/><path d="m13 14.5 3.5 3.5"/>`,
    ),
  ),
  plan: list(
    line(
      `<rect x="2.5" y="2.5" width="15" height="15" rx="2"/><path d="m5 7 1.25 1.25L8.5 5.5M11 7h4m-10 5 1.25 1.25 2.25-2.75M11 12h4"/>`,
    ),
  ),
  prompt: list(
    line(
      `<path d="M3.25 4.25h10.5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9L5.5 16v-2.75H3.25a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2z"/><path d="m16 1 .6 1.8 1.9.7-1.9.6L16 6l-.6-1.9-1.9-.6 1.9-.7z"/>`,
      1.5,
    ),
  ),
  "push-to-talk": list(
    line(
      `<rect x="7" y="1.5" width="6" height="10" rx="3"/><path d="M4.5 9.5v.5a5.5 5.5 0 0 0 11 0v-.5m-5.5 6v3m-2.5 0h5"/>`,
    ),
  ),
  "reasoning-decrease": list(
    line(
      `<path d="M5.25 11.5a3 3 0 0 1-.4-5.7A3.25 3.25 0 0 1 10 3.3a3.25 3.25 0 0 1 5.15 2.5 3 3 0 0 1-.4 5.7M10 7.5v9m-3-3 3 3 3-3"/>`,
      1.5,
    ),
  ),
  "reasoning-increase": list(
    line(
      `<path d="M5.25 11.5a3 3 0 0 1-.4-5.7A3.25 3.25 0 0 1 10 3.3a3.25 3.25 0 0 1 5.15 2.5 3 3 0 0 1-.4 5.7M10 16.5v-9m-3 3 3-3 3 3"/>`,
      1.5,
    ),
  ),
  reasoning: list(
    line(`<path d="M5.25 16V7m-3 3 3-3 3 3m6.5-6v9m-3-3 3 3 3-3"/>`, 1.5),
  ),
  "review-tab": list(
    line(
      `<rect x="1.75" y="2.5" width="16.5" height="15" rx="2"/><path d="M2 6h16m-12.5 5 2.25 2.25L12 9m2.5 1H16m-1.5 3H16"/>`,
      1.5,
    ),
  ),
  scheduled: list(
    line(
      `<rect x="2" y="3.5" width="16" height="14" rx="2"/><path d="M2 7h16M6 1.5v4m8-4v4"/><circle cx="10" cy="12" r="3.25"/><path d="M10 10v2l1.5 1"/>`,
      1.5,
    ),
  ),
  settings: list(
    line(
      `<path d="M2.5 5h15m-15 5h15m-15 5h15"/><circle cx="7" cy="5" r="2"/><circle cx="13" cy="10" r="2"/><circle cx="8.5" cy="15" r="2"/>`,
      1.5,
    ),
  ),
  skills: list(
    line(
      `<path d="m3.5 16.5 9-9"/><path d="m15 1.5.75 2.25L18 4.5l-2.25.75L15 7.5l-.75-2.25L12 4.5l2.25-.75zm-11 3 .5 1.5 1.5.5-1.5.5L4 9l-.5-1.5L2 7l1.5-.5z"/>`,
      1.5,
    ),
  ),
  submit: list(
    line(`<circle cx="10" cy="10" r="8"/><path d="M10 14V6M7 9l3-3 3 3"/>`),
  ),
  terminal: list(
    line(
      `<rect x="1.75" y="3" width="16.5" height="14" rx="2"/><path d="m5 7 3 3-3 3m5 0h4.5"/>`,
    ),
  ),
  "toggle-sidebar": list(
    line(
      `<rect x="1.75" y="2.5" width="16.5" height="15" rx="2"/><path d="M7 3v14M4 8l-2 2 2 2m-2-2h3m8-3h2m-2 3h2m-2 3h2"/>`,
      1.5,
    ),
  ),
  usage: list(
    line(
      `<path d="M3 5h14M3 10h14M3 15h14" opacity=".35"/><path d="M3 5h10m-10 5h7m-7 5h4"/>`,
      1.6,
    ),
  ),
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
