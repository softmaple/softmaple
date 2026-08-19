# `@softmaple/collab-nitro`

Nitro WebSocket service that authenticates document sessions, persists
EG-walker event batches to Supabase Postgres, fans committed batches out to
document peers across instances, and hosts ephemeral awareness rooms.

This is the Nitro host for durable document collaboration when Cloudflare is
not selected. It suits local development and explicit Nitro fallback; for
production, route documents to [`apps/collab-cloudflare`](../collab-cloudflare/README.md)
via `apps/web` collaboration runtime routing. For Nitro-routed documents, the
browser host (`apps/web`) connects with a Supabase credential over same-origin
`/collab/*` URLs. Both this service and `apps/collab-cloudflare` can write
`document_event_batches`; browser clients cannot.

## Role in the stack

The Nitro path (local dev / fallback) is:

```text
Browser ──wss──► /collab/document|presence
                    │
              Vercel Services routing
                    │
               apps/collab-nitro (Nitro)
                    │
         +----------+----------+
         │                     │
       Redis              Supabase Postgres
   realtime / leases      durable EG-walker history
```

Layer boundaries are documented in
[`docs/design/collaboration-layers.md`](../../docs/design/collaboration-layers.md).
This app owns transport and the Supabase/Postgres/Redis adapters. Shared
document-room semantics live in `@softmaple/collab-runtime`; editor bindings
remain outside this service.

| Concern | Owner |
| --- | --- |
| Wire messages / validation | `@softmaple/collab-protocol` |
| Document room / session semantics | `@softmaple/collab-runtime` |
| Rich-text batches / CRDT model | `@softmaple/block-model` / `@softmaple/eg-walker` |
| Lexical projection | `@softmaple/binding-lexical` + `apps/web` |
| Presence protocol / client state | `@softmaple/awareness` |
| Nitro auth, durable-store, and Redis adapters; Nitro presence rooms | **this service** |

## Storage roles

| Store | Responsibility |
| --- | --- |
| **Postgres** | Durable EG-walker event history (`document_event_batches`) |
| **Redis** | Distributed realtime Pub/Sub, presence TTLs, connection leases |
| **Process memory** | Socket objects, local peer lookup, short-lived caches only |

Redis is never the durable collaboration database. Missed realtime messages are
recovered through Postgres + the existing repair/resync protocol.

## Endpoints

| Path | Kind | Purpose |
| --- | --- | --- |
| `/health` | HTTP | Liveness probe (`{ service, status }`) |
| `/collab/health` | HTTP | Same probe under the public `/collab` prefix |
| `/collab/document` | WebSocket | Authenticated collaboration session |
| `/collab/presence` | WebSocket | Authenticated, ephemeral awareness session |

For Nitro-routed documents, the browser connects to the app origin at
`/collab/document` and `/collab/presence`; in production, Vercel Services routes
`/collab/**` to this app. Cloudflare-routed documents connect directly to the
configured Worker URL. Local Playwright uses
`apps/web/scripts/e2e-collab-router.mjs` because stock `next dev` does not
forward WebSocket upgrades.

Upgrades require a browser `Origin` listed in `COLLAB_ALLOWED_ORIGINS` (or a
Vercel preview/production host derived from `VERCEL_*` / `NEXT_PUBLIC_APP_URL`).
User authorization remains Supabase JWT validation + workspace/document
membership (and public-document rules) inside each session.

## Session flow

1. Client opens `wss://<app-origin>/collab/document`.
2. Server validates the browser Origin during WebSocket upgrade.
3. Client sends a v3 `auth` message with a credential (`access-token` or
   `public`), `documentId`, and `sessionId`.
4. Server validates the JWT via Supabase Auth, loads workspace membership,
   acquires a distributed connection lease, and replies with `ready`.
5. Client sends `repair-request` pages until `complete` to hydrate history.
6. Client sends `event` messages with one or more `RichTextEventBatch` values
   (max 64 per message). Writers only: `OWNER` / `EDITOR`.
7. Server appends batches transactionally, returns `durable-ack`, then
   publishes a realtime notification through Redis Pub/Sub so every Nitro
   instance can deliver to its local peers.
8. Authorization and lease refresh run about every 15s while the socket is open.
   Messages are rate-limited (120 / 10s window per peer).

Public credentials are accepted only for documents already marked public.
Those sessions replay and subscribe to history but cannot send events and do
not join Presence. Protocol v3 is current; v2 authenticated clients remain
accepted during rollout.

Presence uses awareness v2 messages, Redis-backed room state with TTL /
heartbeat leases, a 64 KiB frame ceiling, per-peer rate and clock checks,
database-authoritative profiles, and periodic membership reauthorization.
Presence never writes Postgres. When an instance disappears without running
WebSocket `close` handlers, presence members and connection leases expire via
TTL.

## Deployment topology

Multiple Nitro / Vercel Function instances are supported. Configure Upstash
Redis (Vercel Marketplace) and set `REDIS_URL` (native `redis://` / `rediss://`
URL for ioredis). Production and Preview deployments on Vercel select Redis and
never silently fall back to process-local coordination. `REDIS_URL` validation
is currently lazy: missing configuration fails the first document or presence
operation that initializes realtime, not the build, startup, or `/health`
liveness check. Deployment readiness must therefore verify the variable and a
real collaboration WebSocket handshake.

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
cp apps/collab-nitro/.env.example apps/collab-nitro/.env.local
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
| `COLLAB_ALLOWED_ORIGINS` | yes* | Comma-separated browser Origins; Vercel hosts are also auto-allowed |
| `COLLAB_REALTIME_DRIVER` | no | `memory` (local default) or `redis` |
| `REDIS_URL` | on Vercel / when driver=redis | Upstash native Redis URL for ioredis |

`nitro.config.ts` loads `apps/collab-nitro/.env.local`, then
`packages/db/.env`, so local Prisma credentials can be shared.

## Commands

```bash
# Dev server (port 3002)
pnpm --filter @softmaple/collab-nitro dev

# Typecheck / unit tests / production build
pnpm --filter @softmaple/collab-nitro typecheck
pnpm --filter @softmaple/collab-nitro test
pnpm --filter @softmaple/collab-nitro build
pnpm --filter @softmaple/collab-nitro preview
```

`pnpm dev` at the repo root also starts this app via Turborepo alongside
`apps/web`. For same-origin browser WebSockets locally, use the Playwright
router or `vercel dev` (see [`docs/development.mdx`](../../docs/development.mdx)).

## Layout

```text
apps/collab-nitro/
├── nitro.config.ts
├── server/
│   ├── routes/
│   │   ├── collab/
│   │   │   ├── document.ts
│   │   │   ├── presence.ts
│   │   │   └── health.ts
│   │   └── health.ts
│   └── utils/
│       ├── auth.ts
│       ├── origin-auth.ts
│       ├── presence.ts
│       ├── event-store.ts
│       ├── prisma.ts
│       └── realtime/          # bus, leases, presence, Redis/memory adapters
└── test/
```

## Related docs

- [Collaboration architecture layers](../../docs/design/collaboration-layers.md)
- [Development setup](../../docs/development.mdx)
- [Supabase security verification](../../packages/db/supabase/README.md)
