import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(
  readFileSync(
    new URL("../com.marco.chatgato.sdPlugin/manifest.json", import.meta.url),
    "utf8",
  ),
) as {
  Actions: Array<{ Name: string }>;
  SDKVersion: number;
};

describe("Stream Deck manifest", () => {
  it("uses SDK version 3", () => {
    expect(manifest.SDKVersion).toBe(3);
  });

  it("lists sidebar actions alphabetically", () => {
    const actionNames = manifest.Actions.map(({ Name }) => Name);

    expect(actionNames).toEqual([...actionNames].sort((left, right) => left.localeCompare(right)));
  });
});
