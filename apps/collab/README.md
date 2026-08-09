# `@softmaple/collab`

Nitro WebSocket service that authenticates document sessions, persists
EG-walker event batches to Supabase Postgres, and fans committed batches out
to other peers in the same document room.

This replaces Liveblocks for durable document collaboration. The browser host
(`apps/web`) connects with a Supabase access token; this service is the only
writer of `document_event_batches`.

## Role in the stack

```text
Browser ──WebSocket──► apps/web ──HMAC rewrite──► apps/collab
                                                    │
                                                    └──Prisma──► Supabase Postgres

     @softmaple/collab-protocol   (shared wire messages)
     @softmaple/block-model       (RichTextEventBatch payloads)
```

Layer boundaries are documented in
[`docs/design/collaboration-layers.md`](../../docs/design/collaboration-layers.md).
This app owns transport, auth, and persistence only — not editor bindings or
presence.

| Concern | Owner |
| --- | --- |
| Wire messages / validation | `@softmaple/collab-protocol` |
| Rich-text batches / CRDT model | `@softmaple/block-model` / `@softmaple/eg-walker` |
| Lexical projection | `@softmaple/binding-lexical` + `apps/web` |
| Presence / cursors | `@softmaple/awareness` (separate channel) |
| Auth, durable store, fan-out | **this service** |

## Endpoints

| Path | Kind | Purpose |
| --- | --- | --- |
| `/health` | HTTP | Liveness probe (`{ service, status }`) |
| `/document` | WebSocket | Authenticated collaboration session |

The supported browser entry point is the same-origin
`ws(s)://<web>/collab/document` gateway. `apps/web/proxy.ts` validates the
browser Origin, adds an HMAC signature, and rewrites the upgrade to this
service's `/document` endpoint. Direct browser connections to this service are
rejected before peer context is created.

## Session flow

1. Client opens the web gateway. The collab service verifies the server HMAC
   during WebSocket upgrade.
2. Client sends an `auth` message with
   `accessToken`, `documentId`, and `sessionId`.
3. Server validates the JWT via Supabase Auth, loads workspace membership,
   and replies with `ready` (`role`, `canWrite`).
4. Client sends `repair-request` pages (`afterCursor`) until `complete` to
   hydrate history.
5. Client sends `event` messages with one or more `RichTextEventBatch` values
   (max 64 per message). Writers only: `OWNER` / `EDITOR`.
6. Server appends batches transactionally, returns `durable-ack`, then
   publishes the same `event` payload to the document topic.
7. Authorization is re-checked about every 15s while the socket is open.
   Messages are rate-limited (120 / 10s window per peer).

The HMAC authenticates the web gateway, not the user. Supabase access-token
verification and workspace membership remain the document authorization
boundary.

Message shapes and error codes live in `@softmaple/collab-protocol`
(protocol version `2`).

## Persistence

Event batches are stored as immutable rows:

- `document_event_batches` — payload, SHA-256 hash, actor, parent version
- `document_event_ids` — document-wide uniqueness for EG-walker event IDs

Append is idempotent for identical `batch_id` + payload hashes. Conflicting
payloads or missing parent history return a non-retryable `conflict` error.
Browser clients must not write these tables through the Supabase Data API;
see [`packages/db/supabase/README.md`](../../packages/db/supabase/README.md).

## Setup

From the monorepo root:

```bash
pnpm install
cp apps/collab/.env.example apps/collab/.env.local
# Also configure packages/db/.env (DATABASE_URL) and apps/web/.env
pnpm --filter @softmaple/db db:generate
pnpm --filter @softmaple/db db:migrate
```

### Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Prisma connection (pooler URL is fine) |
| `SUPABASE_URL` | yes | Auth project URL |
| `SUPABASE_PUBLISHABLE_KEY` | yes* | Falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `COLLAB_GATEWAY_HMAC_KEYS` | yes | JSON keyring of key IDs to 32-byte, unpadded base64url secrets; keep current and previous keys during rotation |

`nitro.config.ts` loads `apps/collab/.env.local`, then
`packages/db/.env`, so local Prisma credentials can be shared.

HMAC signatures are valid for ±30 seconds and provide bounded replay under
TLS. Nonces are not claimed to be single-use. Rotate by adding a new backend
key, switching the web signer's active key, observing stable reconnects, then
removing the old backend key after the rollback window.

## Commands

```bash
# Dev server (port 3002)
pnpm --filter @softmaple/collab dev

# Typecheck / unit tests / production build
pnpm --filter @softmaple/collab typecheck
pnpm --filter @softmaple/collab test
pnpm --filter @softmaple/collab build
pnpm --filter @softmaple/collab preview
```

`pnpm dev` at the repo root also starts this app via Turborepo alongside
`apps/web`.

## Layout

```text
apps/collab/
├── nitro.config.ts          # Nitro + websocket + env loading
├── server/
│   ├── routes/
│   │   ├── document.ts      # WebSocket collab handler
│   │   └── health.ts
│   └── utils/
│       ├── auth.ts          # JWT + workspace membership
│       ├── event-store.ts   # Append / repair paging
│       └── prisma.ts
└── test/
    └── document-route.test.ts
```

## Related docs

- [Collaboration architecture layers](../../docs/design/collaboration-layers.md)
- [Development setup](../../docs/development.mdx)
- [Supabase security verification](../../packages/db/supabase/README.md)
