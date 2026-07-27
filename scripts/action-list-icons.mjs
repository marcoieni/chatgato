import {
  actionIconSources,
  listGlyph,
  LUCIDE_LICENSE,
  reasoningIconSources,
} from "./lucide-icons.mjs";

const list = (content) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  ${LUCIDE_LICENSE}
  ${content}
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
  "reasoning-decrease": reasoningListIcon("decrease"),
  "reasoning-increase": reasoningListIcon("increase"),
};
