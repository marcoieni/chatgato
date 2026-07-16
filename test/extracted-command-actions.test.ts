import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    new URL("../com.marco.chatgato.sdPlugin/manifest.json", import.meta.url),
    "utf8",
  ),
) as { Actions: Array<{ Name: string; UUID: string }> };

describe("dedicated command actions", () => {
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
});
