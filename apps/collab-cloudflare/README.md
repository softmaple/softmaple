# Cloudflare collaboration PoC

This app started as the issue #871 proof of concept and now includes the
hibernatable room lifecycle from issue #872. It leaves `apps/collab` and its
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

`DocumentRoomDO` accepts its server sockets with the Durable Objects WebSocket
Hibernation API. Each socket has a versioned attachment containing its stable
peer and session identity, protocol/access metadata, the caller's access token
as the reauthorization credential (retained for the connection's lifetime), and
message quota. After constructor re-entry, the object restores all attached
sockets before processing the wake-up message and revalidates each
authenticated session without sending another protocol `Ready` message. The
runtime uses message-driven authorization and lease maintenance in this host,
so no room timer prevents an idle object from hibernating.
Expired peers are revalidated on room activity; if a persistence operation
crosses a validation deadline, repair responses are checked again and expired
fan-out recipients are closed so the existing reconnect-and-repair flow cannot
silently miss a durable batch. A completely idle revoked socket may remain
physically open until the next room wake-up, but it cannot receive data past
its cached validation deadline.

The Durable Object owns only live peer coordination, fan-out, and connection
limits. Durable event append/repair goes through Supabase RPCs backed by the
existing `document_event_batches` and `document_event_ids` Postgres tables.
The RPC migration uses the same per-document transaction advisory lock as the
Nitro host. No Redis dependency is needed for fan-out inside a single object,
and Durable Object SQLite is not used as event history.

A constructor wake revalidates every attached session against Supabase. The
default 100-connection room policy therefore assumes a Workers plan with an
external-subrequest budget large enough for full-room recovery; a lower-budget
deployment must lower that policy or add batched reauthorization first.

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
subclasses the Durable Object and injects a test event adapter. The adapter uses
test-only Durable Object storage to emulate an external durable history source
across forced instance eviction. The production bundle imports only the
Supabase/Postgres adapter, so test credentials cannot select that backend in a
deployed Worker.
