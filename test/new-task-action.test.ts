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

describe("New Task action", () => {
  it("is exposed as a dedicated Stream Deck action", () => {
    expect(manifest.Actions).toContainEqual(
      expect.objectContaining({
        Name: "New Task",
        UUID: "com.marco.chatgato.new-task",
      }),
    );
  });

  it("is not offered by the generic Codex Command selector", () => {
    const commandGroups = propertyInspector.slice(
      propertyInspector.indexOf("const commandGroups"),
      propertyInspector.indexOf("const dedicatedCommandLabels"),
    );
    expect(commandGroups).not.toContain('"newTask"');
    expect(commandGroups).not.toContain("New task");
  });
});
