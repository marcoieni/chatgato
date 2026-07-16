import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    new URL("../com.marco.chatgato.sdPlugin/manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  Actions: Array<{
    Name: string;
    States: Array<{ Title?: string }>;
    UUID: string;
  }>;
};

describe("Stream Deck manifest", () => {
  it("lists sidebar actions alphabetically", () => {
    const actionNames = manifest.Actions.map(({ Name }) => Name);

    expect(actionNames).toEqual([...actionNames].sort((left, right) => left.localeCompare(right)));
  });

  it("labels the prompt action without the redundant run prefix", () => {
    expect(manifest.Actions).toContainEqual(
      expect.objectContaining({
        Name: "Prompt",
        States: [expect.objectContaining({ Title: "PROMPT" })],
        UUID: "com.marco.chatgato.prompt",
      }),
    );
  });
});
