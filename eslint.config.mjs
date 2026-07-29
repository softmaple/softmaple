// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import { defineConfig, globalIgnores } from "eslint/config";

import { config } from "@softmaple/eslint-config/base";

export default defineConfig([
  globalIgnores(["apps/**", "packages/**", "docs/**"]),
  ...config,
  {
    files: ["*.js"],
    languageOptions: {
      sourceType: "commonjs",
    },
  },
  ...storybook.configs["flat/recommended"],
]);
