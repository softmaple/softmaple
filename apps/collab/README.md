# `@softmaple/collab`

Nitro WebSocket service that authenticates document sessions, persists
EG-walker event batches to Supabase Postgres, fans committed batches out to
document peers, and hosts ephemeral awareness rooms.

This replaces Liveblocks for durable document collaboration. The browser host
(`apps/web`) connects with a Supabase access token; this service is the only
writer of `document_event_batches`.

## Role in the stack

```text
Browser ──WebSocket──► apps/web ──HMAC bridge/rewrite──► apps/collab
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
| Presence protocol / client state | `@softmaple/awareness` |
| Auth, durable store, fan-out, presence rooms | **this service** |

## Endpoints

| Path | Kind | Purpose |
| --- | --- | --- |
| `/health` | HTTP | Liveness probe (`{ service, status }`) |
| `/document` | WebSocket | Authenticated collaboration session |
| `/presence` | WebSocket | Authenticated, ephemeral awareness session |

The supported browser entry point is the same-origin
`ws(s)://<web>/collab/document` gateway. `apps/web/proxy.ts` validates the
browser Origin. On Vercel, the web App Router terminates the upgrade and opens
a signed outbound socket to this service; on other hosts the proxy may rewrite
with HMAC headers. Direct unsigned upgrades are normally rejected before peer
context is created. During the rollback window, an unsigned direct upgrade is
temporarily accepted in legacy mode when its Origin is listed in the deprecated
`COLLAB_ALLOWED_ORIGINS`; that path is not HMAC-protected. Remove
`COLLAB_ALLOWED_ORIGINS` after the rollback window to enforce HMAC-only
upgrades.

## Session flow

1. Client opens the web gateway. The collab service verifies the server HMAC
   during WebSocket upgrade.
2. Client sends a v3 `auth` message with a credential (`access-token` or
   `public`), `documentId`, and `sessionId`.
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

Public credentials are accepted only for documents already marked public.
Those sessions replay and subscribe to history but cannot send events and do
not join Presence. Protocol v3 is current; v2 authenticated clients remain
accepted during rollout.

Presence uses its own awareness v2 messages, a 64 KiB frame ceiling, per-peer
rate and clock checks, heartbeat expiry, database-authoritative profiles, and
periodic membership reauthorization. Presence never writes Postgres.

## Deployment topology

Version 1 must run exactly **one Nitro replica**. Document fan-out and Presence
rooms use process-local pub/sub; multiple replicas would partition live peers
even though durable document history remains safe. Configure the hosting
platform for a single instance and do not enable horizontal autoscaling until
a shared pub/sub transport is implemented.

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
│   │   ├── document.ts      # Durable collaboration handler
│   │   ├── presence.ts      # Ephemeral awareness handler
│   │   └── health.ts
│   └── utils/
│       ├── auth.ts          # JWT/public document authorization
│       ├── gateway-auth.ts  # HMAC upgrade verification
│       ├── presence.ts      # Presence parsing, clocks, rate limits
│       ├── event-store.ts   # Append / repair paging
│       └── prisma.ts
└── test/
    └── document-route.test.ts
```

## Related docs

- [Collaboration architecture layers](../../docs/design/collaboration-layers.md)
- [Development setup](../../docs/development.mdx)
- [Supabase security verification](../../packages/db/supabase/README.md)
