# Cloudflare collaboration runtime

This app started as the issue #871 proof of concept, added the hibernatable
document room lifecycle from issue #872, and now adds a presence room from
issue #873 phase 6. It leaves `apps/collab` and its Nitro/Redis deployment
unchanged while hosting the same `@softmaple/collab-runtime` `DocumentRoom`
and `PresenceRoom` semantics in Cloudflare Durable Objects.

It is not yet deployed to a reachable environment — see "Production
deployment" below and
[`docs/design/collaboration-operations.md`](../../docs/design/collaboration-operations.md)
for the cross-runtime operational picture and current rollout stage.

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

## Presence room

The public Worker also keeps the existing `/collab/presence?roomId=` endpoint.
Unlike the document route, presence needs no auth-sniffing proxy in front of
the object: the room id is already known from the query string at upgrade
time, so the Worker validates origin and room id, then routes directly with
`PRESENCE_ROOMS.getByName(roomId)` and returns the object's own upgrade
response. `PresenceRoomDO` accepts sockets the same hibernatable way as
`DocumentRoomDO`, with its own versioned attachment (identity, credential,
rate-limit state, and heartbeat/authorization deadlines — no `Ready`/session
snapshot, since presence never resends one).

`PresenceRoomDO` is a fully separate Durable Object namespace and shares no
capability instance or cross-stub call with `DocumentRoomDO`
(`docs/design/collaboration-runtime.md`'s "Presence room" section is the
source of truth for this boundary; `eslint.config.js` enforces it
mechanically with `no-restricted-imports` between the two files' capability
modules). It gets its own DO-local `ConnectionLimiter` and `PresenceFanout`
(`presence-capabilities.ts`), its own Supabase-backed `PresenceSessionHooks`
(`supabase-presence-backend.ts`), and its own `PresenceCodec` bound to
`@softmaple/awareness/protocol` (`awareness-presence-codec.ts`) — so a
presence failure structurally cannot block durable document convergence, and
a document-store outage cannot block presence.

Presence membership is `ctx.storage`-backed (not in-memory), so it survives
hibernation: each member is stored with its own expiry and purged lazily on
read, matching every other `PresenceStore` implementation's contract. The
room runs in `PresenceRoomOptions.refreshMode: "on-message"`, and a
Cloudflare Durable Object alarm (`PRESENCE_ALARM_INTERVAL_MS`, `constants.ts`)
is the liveness backstop: it is the only timer mechanism that survives
hibernation, so it drives `PresenceRoom.sweep()` to close expired heartbeats
and broadcast Leave for lapsed members even when the room is otherwise idle.
The alarm reschedules itself only while a WebSocket is still attached, so an
empty room does not keep waking the object.

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `COLLAB_ALLOWED_ORIGINS` | yes | Comma-separated browser Origins allowed to open `/collab/*` |
| `SUPABASE_URL` | yes | Same Supabase project as `apps/collab` |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Used for the auth-scoped Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Elevated, server-only — used for the admin-scoped Supabase client that issues RPC calls (`admin.rpc(...)` in `supabase-backend.ts`). Never expose to browser code. |

These four are `wrangler.jsonc`'s `secrets.required` list — the Worker
refuses to start without all of them. Unlike `apps/collab`, this app has no
direct Postgres connection string; it only ever talks to Supabase over its
RPC surface (`append_document_event_batches`, `read_document_event_page`).
See
[`docs/design/collaboration-operations.md`](../../docs/design/collaboration-operations.md#environment-configuration)
for how this compares to Nitro's env config.

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

## Production deployment

**No CD pipeline exists yet, and this app has never been deployed to a
reachable environment.** `.github/workflows/test-collab-cloudflare.yml`
only runs `wrangler deploy --dry-run` as part of CI's `build` step; nothing
runs a real `wrangler deploy`. `wrangler.jsonc` has no `routes` or custom
domain, so even a manual deploy today would only be reachable at the
default `workers.dev` subdomain.

The manual process, until a real pipeline exists:

1. Set each of the four secrets above with `wrangler secret put <NAME>`
   against the target Cloudflare account.
2. Apply the same Prisma migrations applied for local setup, against the
   target environment's Supabase project.
3. `pnpm --filter @softmaple/collab-cloudflare deploy` (runs `wrangler
   deploy` for real — this is the one command in this app that touches a
   live Cloudflare account).
4. Set `NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL` in `apps/web`'s environment
   to the resulting Worker URL — routing stays at 0% until this is set,
   per [`apps/web/README.md`'s routing section](../web/README.md#collaboration-runtime-routing).

## Rollback

To revert a bad deploy of the Worker itself (independent of the routing
decision — see below): `wrangler rollback` reverts to the previously active
version; `wrangler versions list` first if you need to roll back to a
specific, older version by id (`wrangler rollback <VERSION_ID>`). Because no
deployment has ever been exercised, this procedure is documented but
unverified — confirm it works during the first real Stage 2 deployment
rather than assuming it does.

This is a different lever from **routing rollback** (moving documents back
to Nitro without touching what's deployed here) — see
[`apps/web/README.md`'s routing section](../web/README.md#collaboration-runtime-routing)
and
[`docs/design/collaboration-operations.md`](../../docs/design/collaboration-operations.md#rollback-procedure)
for that procedure and how the two levels relate.

## Verification

```bash
pnpm --filter @softmaple/collab-cloudflare test
pnpm --filter @softmaple/collab-cloudflare typecheck
pnpm --filter @softmaple/collab-cloudflare lint
pnpm --filter @softmaple/collab-cloudflare build
```

The Cloudflare Vitest suite runs in `workerd` with a test entry point that
subclasses each Durable Object and injects a test event adapter. The adapter
uses test-only Durable Object storage to emulate an external durable history
source (for documents) or authorization backend (for presence) across forced
instance eviction. The production bundle imports only the Supabase/Postgres
adapters, so test credentials cannot select that backend in a deployed
Worker. `test/document-presence-isolation.test.ts` exercises the two objects
together for the same room id to prove the no-shared-capability boundary at
runtime, not just statically.

`--no-isolate` runs the whole suite in one `workerd` process, so its two
Durable Object namespaces' SQLite-backed storage accumulates across every
test file; `vitest.config.ts` raises `testTimeout`/`hookTimeout` to 30s to
give the later files enough room.

CI runs this suite in `.github/workflows/test-collab-cloudflare.yml`,
path-filtered on this app and the packages it depends on.
