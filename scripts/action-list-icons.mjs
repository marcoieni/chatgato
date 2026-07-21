const list = (content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  ${content}
</svg>\n`;

const line = (content, width = 1.75) =>
  `<g fill="none" stroke="#FFFFFF" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${content}</g>`;

export const actionListIcons = {
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
  "new-task": list(line(`<path d="M10 3v14M3 10h14"/>`, 2)),
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
