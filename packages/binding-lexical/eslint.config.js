import { config } from "@softmaple/eslint-config/base";
import { blockModelBindingCollaborationPatterns } from "@softmaple/eslint-config/collaboration-layers";

export default [
  ...config,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: blockModelBindingCollaborationPatterns },
      ],
    },
  },
];
