import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    new URL("../com.marco.chatgato.sdPlugin/manifest.json", import.meta.url),
    "utf8",
  ),
) as { Actions: Array<{ Name: string; UUID: string }> };

describe("Fast Mode action", () => {
  it("is exposed as a dedicated Stream Deck action", () => {
    expect(manifest.Actions).toContainEqual(
      expect.objectContaining({
        Name: "Fast Mode",
        UUID: "com.marco.chatgato.fast-mode",
      }),
    );
  });
});
