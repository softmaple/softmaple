import { config } from "@softmaple/eslint-config/base";

export default [
  ...config,
  {
    ignores: ["dist/**", "worker-configuration.d.ts"],
  },
  {
    files: ["**/*.d.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
];
