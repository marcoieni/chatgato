import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    new URL("../com.marco.chatgato.sdPlugin/manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  Actions: Array<{
    Controllers: string[];
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

  it("uses dedicated monochrome action-list icons", () => {
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

  it("uses the shared title-safe shell for key artwork", () => {
    const stateImages = new Set(
      manifest.Actions.map((action) => action.States[0]?.Image).filter(
        (image): image is string => image !== undefined,
      ),
    );

    for (const image of stateImages) {
      const imageUrl = new URL(
        `../com.marco.chatgato.sdPlugin/${image}.svg`,
        import.meta.url,
      );
      const svg = readFileSync(imageUrl, "utf8");

      expect(svg).toContain(
        '<rect width="144" height="144" rx="24" fill="#071018"/>',
      );
      expect(svg).toContain(
        '<rect x="8" y="8" width="128" height="128" rx="20" fill="none" stroke="#FFFFFF" stroke-opacity=".12" stroke-width="2"/>',
      );
    }
  });

  it("centers every keypad glyph in the title-safe accent panel", () => {
    const stateImages = new Set(
      manifest.Actions.filter((action) => action.Controllers.includes("Keypad"))
        .map((action) => action.States[0]?.Image)
        .filter((image): image is string => image !== undefined),
    );

    for (const image of stateImages) {
      const imageUrl = new URL(
        `../com.marco.chatgato.sdPlugin/${image}.svg`,
        import.meta.url,
      );
      const svg = readFileSync(imageUrl, "utf8");

      if (!svg.includes('<rect x="28" y="14" width="88" height="80"')) {
        continue;
      }

      const centeredGroup = svg.match(
        /<g data-source-center="([\d.-]+) ([\d.-]+)" data-glyph-center="([\d.-]+) ([\d.-]+)" transform="translate\(([\d.-]+) ([\d.-]+)\)">/,
      );
      expect(
        centeredGroup,
        `${image} is missing its centered glyph group`,
      ).not.toBeNull();

      const [, sourceX, sourceY, targetX, targetY, offsetX, offsetY] =
        centeredGroup!;
      expect(Number(sourceX) + Number(offsetX), `${image} x center`).toBe(
        Number(targetX),
      );
      expect(Number(sourceY) + Number(offsetY), `${image} y center`).toBe(
        Number(targetY),
      );
      expect([Number(targetX), Number(targetY)]).toEqual([72, 54]);
    }
  });
});
