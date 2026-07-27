import {
  actionIconSources,
  listGlyph,
  LUCIDE_LICENSE,
  reasoningIconSources,
} from "./lucide-icons.mjs";

const list = (content, { usesLucide = true } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  ${usesLucide ? `${LUCIDE_LICENSE}\n  ` : ""}${content}
</svg>\n`;

const actionListEntries = Object.entries(actionIconSources).map(
  ([name, source]) => [name, list(listGlyph(source))],
);

const reasoningListIcon = (direction) =>
  list(
    `${listGlyph(reasoningIconSources.brain, {
      center: [7.5, 10],
      size: 13,
    })}
    ${listGlyph(reasoningIconSources[direction], {
      center: [16, 10],
      size: 8,
    })}`,
  );

export const actionListIcons = {
  ...Object.fromEntries(actionListEntries),
  fork: list(
    `<g fill="none" stroke="#FFFFFF" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 10h5l6-6m-4 0h4v4m-4 4 4 4m-4 0h4v-4"/></g>`,
    { usesLucide: false },
  ),
  "reasoning-decrease": reasoningListIcon("decrease"),
  "reasoning-increase": reasoningListIcon("increase"),
};
