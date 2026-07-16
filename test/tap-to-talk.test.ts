import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    new URL("../com.marco.chatgato.sdPlugin/manifest.json", import.meta.url),
    "utf8",
  ),
) as { Actions: Array<{ Name: string; UUID: string }> };

const propertyInspector = readFileSync(
  new URL("../com.marco.chatgato.sdPlugin/ui/pi.js", import.meta.url),
  "utf8",
);

describe("Tap to Talk action", () => {
  it("is exposed as a dedicated Stream Deck action", () => {
    expect(manifest.Actions).toContainEqual(
      expect.objectContaining({
        Name: "Tap to Talk",
        UUID: "com.marco.chatgato.tap-to-talk",
      }),
    );
  });

  it("explains its toggle behavior in the property inspector", () => {
    expect(propertyInspector).toContain('case "com.marco.chatgato.tap-to-talk"');
    expect(propertyInspector).toContain("Press once to start dictation, then press again to stop it.");
  });
});
