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

describe("commands extracted into dedicated actions", () => {
  it.each([
    ["Plan", "com.marco.chatgato.plan"],
    ["Skills", "com.marco.chatgato.skills"],
    ["Scheduled", "com.marco.chatgato.scheduled"],
    ["Go Back", "com.marco.chatgato.go-back"],
    ["Go Forward", "com.marco.chatgato.go-forward"],
    ["Toggle Sidebar", "com.marco.chatgato.toggle-sidebar"],
  ])("exposes %s as a dedicated Stream Deck action", (name, uuid) => {
    expect(manifest.Actions).toContainEqual(
      expect.objectContaining({ Name: name, UUID: uuid }),
    );
  });

  it("removes the extracted actions from the generic Codex Command selector", () => {
    const commandGroups = propertyInspector.slice(
      propertyInspector.indexOf("const commandGroups"),
      propertyInspector.indexOf("const dedicatedCommandLabels"),
    );

    expect(commandGroups).not.toContain('"togglePlan"');
    expect(commandGroups).not.toContain('"skills"');
    expect(commandGroups).not.toContain('"scheduled"');
    expect(commandGroups).not.toContain('"navigateBack"');
    expect(commandGroups).not.toContain('"navigateForward"');
    expect(commandGroups).not.toContain('"toggleSidebar"');
  });
});
