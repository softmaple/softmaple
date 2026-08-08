# `@softmaple/collab`

Nitro WebSocket service that authenticates document sessions, persists
EG-walker event batches to Supabase Postgres, and fans committed batches out
to other peers in the same document room.

This replaces Liveblocks for durable document collaboration. The browser host
(`apps/web`) connects with a Supabase access token; this service is the only
writer of `document_event_batches`.

## Role in the stack

```text
apps/web  ──WebSocket──►  apps/collab  ──Prisma──►  Supabase Postgres
                ▲
                │
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

Dev default: `ws://localhost:3002/document` (see `NEXT_PUBLIC_COLLAB_WS_URL` in
`apps/web`).

WebSocket upgrade uses the `softmaple-collab-v2` protocol and rejects origins
outside `COLLAB_ALLOWED_ORIGINS`.

## Session flow

1. Client opens `/document` and sends an `auth` message with
   `accessToken`, `documentId`, and `sessionId`.
2. Server validates the JWT via Supabase Auth, loads workspace membership,
   and replies with `ready` (`role`, `canWrite`).
3. Client sends `repair-request` pages (`afterCursor`) until `complete` to
   hydrate history.
4. Client sends `event` messages with one or more `RichTextEventBatch` values
   (max 64 per message). Writers only: `OWNER` / `EDITOR`.
5. Server appends batches transactionally, returns `durable-ack`, then
   publishes the same `event` payload to the document topic.
6. Authorization is re-checked about every 15s while the socket is open.
   Messages are rate-limited (120 / 10s window per peer).

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
| `COLLAB_ALLOWED_ORIGINS` | no | Comma-separated; defaults to `http://localhost:3000` and `http://127.0.0.1:3000` |
| `COLLAB_ALLOW_MISSING_ORIGIN` | no | Set `true` only for non-browser clients that omit `Origin` |

`nitro.config.ts` loads `apps/collab/.env.local`, then
`packages/db/.env`, so local Prisma credentials can be shared.

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
