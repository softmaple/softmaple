import { nextJsConfig } from "@softmaple/eslint-config/next-js";

/** @type {import("eslint").Linter.Config} */
export default [
  ...nextJsConfig,
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
];
