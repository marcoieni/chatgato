import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    new URL("../com.marco.chatgato.sdPlugin/manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  Actions: Array<{ Name: string }>;
};

describe("Stream Deck manifest", () => {
  it("lists sidebar actions alphabetically", () => {
    const actionNames = manifest.Actions.map(({ Name }) => Name);

    expect(actionNames).toEqual([...actionNames].sort((left, right) => left.localeCompare(right)));
  });
});
