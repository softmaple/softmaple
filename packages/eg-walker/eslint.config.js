import { config } from "@softmaple/eslint-config/base";

export default [
  ...config,
  {
    files: ["src/test/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];
