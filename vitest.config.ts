import type { PresetObject } from "@babel/core";
import babel, { defineRolldownBabelPreset } from "@rolldown/plugin-babel";
import { defineConfig } from "vitest/config";

function decoratorPreset(options: Record<string, unknown>) {
  return defineRolldownBabelPreset({
    preset: (): PresetObject => ({
      plugins: [["@babel/plugin-proposal-decorators", options]],
    }),
    rolldown: {
      filter: {
        code: "@",
      },
    },
  });
}

export default defineConfig({
  plugins: [
    babel({
      presets: [decoratorPreset({ version: "2023-11" })],
    }),
  ],
});
