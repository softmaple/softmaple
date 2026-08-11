# Cloudflare collaboration PoC

This app is the issue #871 proof of concept. It leaves `apps/collab` and its
Nitro/Redis deployment unchanged while hosting the same
`@softmaple/collab-runtime` `DocumentRoom` semantics in Cloudflare Durable
Objects.

## Runtime shape

The public Worker keeps the existing `/collab/document` WebSocket endpoint. It
reads the first protocol `Auth` message, normalizes its document UUID, and
routes the connection with `DOCUMENT_ROOMS.getByName(documentId)`. Every live
connection for that document is therefore coordinated by one `DocumentRoomDO`.
The Worker proxies the unchanged `@softmaple/collab-protocol` messages into the
object; there is no Cloudflare-specific wire format.

The Durable Object owns only live peer coordination, fan-out, and connection
limits. Durable event append/repair goes through Supabase RPCs backed by the
existing `document_event_batches` and `document_event_ids` Postgres tables.
The RPC migration uses the same per-document transaction advisory lock as the
Nitro host. No Redis dependency is needed for fan-out inside a single object,
and Durable Object SQLite is not used as event history.

## Local setup

Create `apps/collab-cloudflare/.dev.vars` (it is ignored by the repository) with:

```dotenv
COLLAB_ALLOWED_ORIGINS=http://localhost:3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
```

Apply the Prisma migrations to the same Supabase/Postgres database used by the
Nitro collaboration service, then run:

```bash
pnpm --filter @softmaple/collab-cloudflare cf-typegen
pnpm --filter @softmaple/collab-cloudflare dev
```

Set the same values with `wrangler secret put` before deployment. Never expose
the service-role key to browser code.

## Verification

```bash
pnpm --filter @softmaple/collab-cloudflare test
pnpm --filter @softmaple/collab-cloudflare typecheck
pnpm --filter @softmaple/collab-cloudflare build
```

The Cloudflare Vitest suite runs in `workerd` with a test entry point that
subclasses the Durable Object and injects an in-memory event adapter. The
production bundle imports only the Supabase/Postgres adapter, so test
credentials cannot select a non-durable backend in a deployed Worker.
