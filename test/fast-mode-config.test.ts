import { describe, expect, it } from "vitest";
import { fastModeEnabledFromConfig } from "../src/lib/fast-mode-config.js";

describe("fastModeEnabledFromConfig", () => {
  it.each([
    ["fast", undefined, true],
    ["fast", true, true],
    ["priority", undefined, true],
    ["priority", true, true],
    ["fast", false, false],
    ["priority", false, false],
    ["default", true, false],
    [undefined, true, false],
  ])(
    "interprets service tier %j and feature value %j as %j",
    (serviceTier, featureEnabled, expected) => {
      expect(fastModeEnabledFromConfig(serviceTier, featureEnabled)).toBe(
        expected,
      );
    },
  );
});
