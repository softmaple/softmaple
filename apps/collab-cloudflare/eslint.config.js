import { config } from "@softmaple/eslint-config/base";

// `PresenceRoomDO` and `DocumentRoomDO` share no capability instance and
// make no cross-stub call (see docs/design/collaboration-runtime.md's
// "Presence room" section). These are the document-side and presence-side
// files that wire each object's own capabilities; neither side may import
// the other's, even indirectly through a relative path.
const DOCUMENT_CAPABILITY_FILES = [
  "**/document-room-do",
  "**/do-capabilities",
  "**/room-services",
  "**/supabase-backend",
  "**/websocket-attachment",
  "**/websocket-proxy",
];
const PRESENCE_CAPABILITY_FILES = [
  "**/presence-room-do",
  "**/presence-capabilities",
  "**/presence-services",
  "**/supabase-presence-backend",
  "**/presence-attachment",
  "**/presence-websocket",
  "**/awareness-presence-codec",
];

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
  {
    files: [
      "src/presence-*.ts",
      "src/awareness-presence-codec.ts",
      "src/supabase-presence-backend.ts",
      "test/presence-*.ts",
      "test/memory-presence-backend.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: DOCUMENT_CAPABILITY_FILES,
              message:
                "Isolation boundary: PresenceRoomDO must share no capability instance with DocumentRoomDO. See docs/design/collaboration-runtime.md.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/document-room-do.ts",
      "src/do-capabilities.ts",
      "src/room-services.ts",
      "src/supabase-backend.ts",
      "src/websocket-attachment.ts",
      "src/websocket-proxy.ts",
      "test/document-room-do.test.ts",
      "test/do-capabilities.test.ts",
      "test/memory-backend.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: PRESENCE_CAPABILITY_FILES,
              message:
                "Isolation boundary: DocumentRoomDO must share no capability instance with PresenceRoomDO. See docs/design/collaboration-runtime.md.",
            },
          ],
        },
      ],
    },
  },
];
