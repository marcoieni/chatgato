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

describe("Reasoning action", () => {
  it("is exposed as a dedicated Stream Deck action", () => {
    expect(manifest.Actions).toContainEqual(
      expect.objectContaining({
        Name: "Reasoning",
        UUID: "com.marco.chatgato.reasoning",
      }),
    );
  });

  it("does not offer reasoning changes in the generic Codex Command selector", () => {
    const commandGroups = propertyInspector.slice(
      propertyInspector.indexOf("const commandGroups"),
      propertyInspector.indexOf("const dedicatedCommandLabels"),
    );
    expect(commandGroups).not.toContain('"reasoningUp"');
    expect(commandGroups).not.toContain('"reasoningDown"');
    expect(commandGroups).not.toContain("Increase reasoning");
    expect(commandGroups).not.toContain("Decrease reasoning");
  });
});
