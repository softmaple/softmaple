import { config } from "@softmaple/eslint-config/base";

// `PresenceRoomDO` and `DocumentRoomDO` share no capability instance and
// make no cross-stub call (see docs/design/collaboration-runtime.md's
// "Presence room" section). Rather than only denying the other side's known
// capability files (which an unclassified relay module could bypass), these
// are allowlists: any local import from a presence-side file that isn't one
// of its own files or a shared, capability-free utility is denied, and
// symmetrically for the document side. `src/index.ts` and `test/worker.ts`
// are composition roots that legitimately wire both sides, so neither glob
// below includes them.
// `auth-deadline` and `websocket-close` are shared the same way the others
// are: pure policy/helper functions plus a caller-supplied-storage alarm
// write. They hold no capability instance and reach neither object's room,
// so importing them creates no coupling between the two sides.
const SHARED_UTILITY_FILES =
  "auth-deadline|constants|document-id|origin|message-bytes|supabaseTypes|websocket-close";
const PRESENCE_OWN_FILES =
  "presence-[\\w-]*|awareness-presence-codec|supabase-presence-backend|memory-presence-backend";
const DOCUMENT_OWN_FILES =
  "document-room-do|document-websocket|do-capabilities|room-services|supabase-backend|websocket-attachment|memory-backend";

const denyLocalImportsExcept = (allowedNames) =>
  new RegExp(`^\\.{1,2}/(?:.*/)?(?!(?:${allowedNames})$)[\\w-]+$`);

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
              regex: denyLocalImportsExcept(
                `${PRESENCE_OWN_FILES}|${SHARED_UTILITY_FILES}`,
              ).source,
              message:
                "Isolation boundary: PresenceRoomDO must share no capability instance with DocumentRoomDO, directly or through a relay module. See docs/design/collaboration-runtime.md.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/document-room-do.ts",
      "src/document-websocket.ts",
      "src/do-capabilities.ts",
      "src/room-services.ts",
      "src/supabase-backend.ts",
      "src/websocket-attachment.ts",
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
              regex: denyLocalImportsExcept(
                `${DOCUMENT_OWN_FILES}|${SHARED_UTILITY_FILES}`,
              ).source,
              message:
                "Isolation boundary: DocumentRoomDO must share no capability instance with PresenceRoomDO, directly or through a relay module. See docs/design/collaboration-runtime.md.",
            },
          ],
        },
      ],
    },
  },
];
