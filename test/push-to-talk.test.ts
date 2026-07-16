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

describe("Push to Talk action", () => {
  it("is exposed as a dedicated Stream Deck action", () => {
    expect(manifest.Actions).toContainEqual(
      expect.objectContaining({
        Name: "Push to Talk",
        UUID: "com.marco.chatgato.push-to-talk",
      }),
    );
  });

  it("is not offered by the generic Codex Command selector", () => {
    const commandGroups = propertyInspector.slice(
      propertyInspector.indexOf("const commandGroups"),
      propertyInspector.indexOf("function renderCommand"),
    );
    expect(commandGroups).not.toContain('"ptt"');
    expect(commandGroups).not.toContain("Push to talk (hold)");
  });
});
