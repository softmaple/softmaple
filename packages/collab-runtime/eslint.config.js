import { config } from "@softmaple/eslint-config/base";
import { collabRuntimeCollaborationPatterns } from "@softmaple/eslint-config/collaboration-layers";

export default [
  ...config,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: collabRuntimeCollaborationPatterns },
      ],
    },
  },
];
