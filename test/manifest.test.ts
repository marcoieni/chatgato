import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    new URL("../com.marco.chatgato.sdPlugin/manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  Actions: Array<{
    Icon: string;
    Name: string;
    States: Array<{ Image: string }>;
    UUID: string;
  }>;
  SDKVersion: number;
};

describe("Stream Deck manifest", () => {
  it("uses SDK version 3", () => {
    expect(manifest.SDKVersion).toBe(3);
  });

  it("lists sidebar actions alphabetically", () => {
    const actionNames = manifest.Actions.map(({ Name }) => Name);

    expect(actionNames).toEqual(
      [...actionNames].sort((left, right) => left.localeCompare(right)),
    );
  });

  it("does not expose the removed generic Codex Command action", () => {
    expect(manifest.Actions).not.toContainEqual(
      expect.objectContaining({ UUID: "com.marco.chatgato.command" }),
    );
  });

  it("uses dedicated monochrome action-list icons without changing key artwork", () => {
    for (const action of manifest.Actions) {
      expect(action.Icon).toMatch(/^imgs\/action-list\/[a-z-]+$/);
      expect(action.States[0]?.Image).toMatch(/^imgs\/actions\/[a-z-]+$/);
      expect(action.Icon).not.toBe(action.States[0]?.Image);

      const iconUrl = new URL(
        `../com.marco.chatgato.sdPlugin/${action.Icon}.svg`,
        import.meta.url,
      );
      expect(
        existsSync(iconUrl),
        `${action.Name} action-list icon is missing`,
      ).toBe(true);

      const svg = readFileSync(iconUrl, "utf8");
      const colors = svg.match(/#[0-9a-f]{3,8}/gi) ?? [];
      const rootTag = svg.match(/<svg\b[^>]*>/)?.[0] ?? "";
      const attribute = (name: string) =>
        rootTag.match(new RegExp(`\\b${name}=(['"])(.*?)\\1`))?.[2];
      const normalizedColors = colors.map((color) =>
        color.length === 4
          ? `#${[...color.slice(1)]
              .map((component) => component.repeat(2))
              .join("")}`.toUpperCase()
          : color.toUpperCase(),
      );

      expect(attribute("width")).toBe("20");
      expect(attribute("height")).toBe("20");
      expect(attribute("viewBox")?.trim().split(/\s+/)).toEqual([
        "0",
        "0",
        "20",
        "20",
      ]);
      expect(new Set(normalizedColors)).toEqual(new Set(["#FFFFFF"]));
      expect(svg).not.toMatch(
        /<rect[^>]+(?:width="20"[^>]+height="20"|height="20"[^>]+width="20")/,
      );
    }
  });
});
