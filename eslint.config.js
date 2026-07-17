import babelParser from "@babel/eslint-parser";
import eslint from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["com.marco.chatgato.sdPlugin/bin/**", "dist/**"],
  },
  eslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          parserOpts: {
            plugins: [
              "typescript",
              ["decorators", { decoratorsBeforeExport: true }],
            ],
          },
        },
      },
      globals: globals.node,
    },
    rules: {
      // Babel's ESTree scope analysis does not model TypeScript-only names.
      // TypeScript's strict typecheck covers undefined and unused type symbols.
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    files: ["com.marco.chatgato.sdPlugin/ui/**/*.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
];
