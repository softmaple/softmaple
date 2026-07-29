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
]);
