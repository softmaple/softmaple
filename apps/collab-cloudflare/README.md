# Cloudflare collaboration runtime

This app started as the issue #871 proof of concept, added the hibernatable
document room lifecycle from issue #872, and now adds a presence room from
issue #873 phase 6. It leaves `apps/collab-nitro` and its Nitro/Redis deployment
unchanged while hosting the same `@softmaple/collab-runtime` `DocumentRoom`
and `PresenceRoom` semantics in Cloudflare Durable Objects.

The repository does not automate deployment or configure `apps/web` to select
this runtime by default — see "Production deployment" below and
[`docs/design/collaboration-operations.md`](../../docs/design/collaboration-operations.md)
for the cross-runtime operational picture and configured rollout stage.

## Runtime shape

The public Worker keeps the existing `/collab/document` WebSocket endpoint,
now with the document UUID on the URL:
`/collab/document?documentId=<uuid>`. The Worker validates the browser
Origin, normalizes that id, and returns
`DOCUMENT_ROOMS.getByName(documentId).fetch(request)` — the object's own
upgrade response. Every live connection for that document is therefore
coordinated by one `DocumentRoomDO`, and the Worker never terminates,
relays, or holds a document socket: it performs HTTP routing and Durable
Object selection only, exactly like the presence route below. The
`@softmaple/collab-protocol` messages are unchanged; there is no
Cloudflare-specific wire format.

The routed document id is an identifier, not a credential: it selects which
object serves the socket and nothing else. Possessing it authorizes nothing,
and no access token, JWT, or other secret ever belongs in the query string.
Authentication and authorization still happen inside the object, driven by
the connection's first protocol `Auth` message — access token or public
credential, document existence, workspace membership, and collaboration
permissions are all still checked before `Ready`. The object additionally
requires that message's document id (in any UUID spelling) to normalize to
the routed one, and answers a mismatch with the same `AuthenticationFailed`
error and 1008 `Unauthorized` close that an unauthorized credential gets, so
a client cannot open document A's object and authenticate against document
B. That check runs before the authorization hook, so a mismatched `Auth`
never reaches Supabase.

`DocumentRoomDO` accepts its server sockets with the Durable Objects WebSocket
Hibernation API. Each socket has a versioned attachment containing its routed
document id, stable peer and session identity, protocol/access metadata, the
caller's access token as the reauthorization credential (retained for the
connection's lifetime), and message quota. The routed id reaches the object on
the upgrade request and is persisted in that attachment, which is how a
hibernation-evicted object rebinds itself to its document without any Worker
or process-global state. After constructor re-entry, the object restores all
attached sockets before processing the wake-up message and revalidates each
authenticated session without sending another protocol `Ready` message. The
runtime uses message-driven authorization and lease maintenance in this host,
so no room timer prevents an idle object from hibernating.

Owning the whole connection also means owning its ending: `webSocketClose`
answers the client's close frame, echoing valid non-reserved close codes
and mapping invalid or reserved codes to 1000 so the handshake completes
cleanly instead of the client timing out at 1006. `PresenceRoomDO` answers
its clients' close frames the same way, through the same shared
`websocket-close.ts`.

A socket that connects and never sends `Auth` is closed 1008
`Authentication timed out` at `INITIAL_AUTH_TIMEOUT_MS` (`constants.ts`).
Both room objects enforce that deadline from a Durable Object alarm rather
than the `setTimeout` the removed Worker proxy used, because no timer
survives hibernation and no Worker-side socket is left to hold one. The
accepted-at instant lives in each socket's attachment, so `alarm()` decides
purely from attachments: a woken object evicts exactly the sockets a live one
would, without restoring the room, revalidating a session, or calling
Supabase — an unauthenticated socket holds no session, membership, or
connection lease, so closing its transport is the whole eviction. The shared
policy is `auth-deadline.ts`; a Durable Object has one alarm, so an
authentication deadline may only pull an already-scheduled wake-up forward
(`PresenceRoomDO`'s liveness sweep keeps its own 30s cadence). The document
object schedules an alarm only while a socket is still awaiting `Auth` and
re-arms only while one remains, so an idle authenticated room still
hibernates with no timer at all. The accepted-at instant is a required
attachment field, so a socket that was still awaiting `Auth` across a
deployment fails the attachment parse when its object wakes on the new
version and is closed like any other unreadable attachment — it has no
session to lose, and the client reconnects and authenticates again.

Expired peers are revalidated on room activity; if a persistence operation
crosses a validation deadline, repair responses are checked again and expired
fan-out recipients are closed so the existing reconnect-and-repair flow cannot
silently miss a durable batch. A completely idle revoked socket may remain
physically open until the next room wake-up, but it cannot receive data past
its cached validation deadline.

`DocumentRoomDO` owns live document peer coordination, fan-out, and connection
limits. Durable event append/repair goes through Supabase RPCs backed by the
existing `document_event_batches` and `document_event_ids` Postgres tables.
The RPC migration uses the same per-document transaction advisory lock as the
Nitro host. No Redis dependency is needed for fan-out inside a single object,
and Durable Object SQLite is not used as document event history. The separate
`PresenceRoomDO` does use Durable Object storage for live presence membership,
as described below.

A constructor wake revalidates every attached session against Supabase. The
default 100-connection room policy therefore assumes a Workers plan with an
external-subrequest budget large enough for full-room recovery; a lower-budget
deployment must lower that policy or add batched reauthorization first.

## Presence room

The public Worker also keeps the existing `/collab/presence?roomId=` endpoint,
routed exactly like the document endpoint above: the room id is known from the
query string at upgrade time, so the Worker validates origin and room id, then
routes directly with `PRESENCE_ROOMS.getByName(roomId)` and returns the
object's own upgrade response. `PresenceRoomDO` accepts sockets the same
hibernatable way as `DocumentRoomDO`, with its own versioned attachment
(identity, credential, rate-limit state, and heartbeat/authorization deadlines
— no `Ready`/session snapshot, since presence never resends one).

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
an event-store-specific failure cannot block presence. A broader Supabase Auth
or Data API outage can still affect both rooms.

Presence membership is `ctx.storage`-backed (not in-memory), so it survives
hibernation: each member is stored with its own expiry and purged lazily on
read, matching every other `PresenceStore` implementation's contract. The
room runs in `PresenceRoomOptions.refreshMode: "on-message"`, and a
Cloudflare Durable Object alarm (`PRESENCE_ALARM_INTERVAL_MS`, `constants.ts`)
is the liveness backstop: it is the only timer mechanism that survives
hibernation, so it drives `PresenceRoom.sweep()` to close expired heartbeats
and broadcast Leave for lapsed members even when the room is otherwise idle.
The same alarm also runs the shared authentication-deadline sweep described
above. The alarm reschedules itself only while a WebSocket is still attached,
so an empty room does not keep waking the object.

## Environment

| Variable | Required | Notes |
| --- | --- | --- |
| `COLLAB_ALLOWED_ORIGINS` | yes | Comma-separated browser Origins allowed to open `/collab/*` |
| `SUPABASE_URL` | yes | Same Supabase project as `apps/collab-nitro` |
| `SUPABASE_PUBLISHABLE_KEY` | yes | Used for the auth-scoped Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Elevated, server-only — used for event RPCs and privileged Data API reads of documents, workspace memberships, and user profiles. Never expose to browser code. |

These four are `wrangler.jsonc`'s `secrets.required` list. A normal
`wrangler deploy` validates that an existing Worker has all four and fails with
an error listing missing bindings; a first deploy can provide all four with
`--secrets-file`. `wrangler dev` (and the Vitest suite, which shares this
check) only warns about missing local values and still starts. Unlike
`apps/collab-nitro`, this app has no direct Postgres connection string. Durable event
append/read use `append_document_event_batches` and
`read_document_event_page`; session authorization and presence also call
Supabase Auth and query `documents`, `workspace_members`, and `users` through
the Data API.
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
pnpm exec turbo run dev --filter=@softmaple/collab-cloudflare
```

Run the Worker through Turbo, as above, rather than invoking its package-level
`dev` script directly. The Worker bundles compiled workspace-package exports;
Turbo's `dev` dependency graph rebuilds those packages first, so a source
change cannot be hidden by an older ignored `dist/` directory.

Never expose the service-role key to browser code. For production, follow the
atomic first-deploy or later-rotation procedure below; do not bootstrap a new
Worker with `wrangler secret put`.

## Production deployment

**No CD pipeline exists in the repository.**
`.github/workflows/test-collab-cloudflare.yml` only runs
`wrangler deploy --dry-run` as part of CI's `build` step; repository automation
does not run a real deployment. `wrangler.jsonc` declares no route or custom
domain, but `workers_dev` defaults to `true`, so a deploy publishes a reachable
`workers.dev` endpoint. These facts do not prove Cloudflare account state: a
Worker, deployment, route, custom domain, or traffic may already exist through
manual commands or the dashboard.

### First deployment

Do not bootstrap a missing Worker with `wrangler secret put`. In the pinned
Wrangler version, that command first creates and deploys placeholder Worker
code, then deploys another version containing the secret. Supply all required
secrets with the real application deployment instead:

1. Confirm Wrangler is authenticated to the intended Cloudflare account with
   `pnpm --filter @softmaple/collab-cloudflare exec wrangler whoami`. Before
   any mutation, run
   `pnpm --filter @softmaple/collab-cloudflare exec wrangler deployments status`
   (a not-found result is expected for a new Worker), and inspect the Cloudflare
   dashboard for routes, custom domains, and current traffic. Continue this
   first-deployment procedure only if the Worker is absent and no external
   trigger points at its intended name. If it exists, treat it as an existing
   production resource: inventory its active and latest versions, bindings,
   triggers, and traffic, then use the later-deployment procedure or stop for
   reconciliation.
2. Apply the repository's Prisma migrations to the target Supabase/Postgres
   database.
3. Create `apps/collab-cloudflare/.dev.vars.production` with all four required
   values. The repository's `.dev.vars*` ignore rule prevents it from being
   committed; still treat the file as temporary production secret material.
4. Deploy the real Worker code, required secrets, and Durable Object migrations
   together:

   ```bash
   pnpm exec turbo run build \
     --filter=@softmaple/collab-cloudflare... \
     --filter=!@softmaple/collab-cloudflare
   pnpm --filter @softmaple/collab-cloudflare exec wrangler deploy \
     --secrets-file .dev.vars.production
   ```

   A plain first `wrangler deploy` cannot inherit required bindings from a
   Worker that does not exist.
5. Securely remove the temporary file or retain it only in an approved secret
   manager. The Worker is now reachable on its `workers.dev` URL. Verify its
   HTTP/WebSocket paths, both event RPCs, Auth, and the required Data API table
   reads before configuring `apps/web` to select it.
6. Set `COLLAB_CLOUDFLARE_WS_URL` in `apps/web`'s environment to the
   resulting Worker URL, then **redeploy `apps/web`** — setting the variable
   alone does nothing for an already-running deployment; routing stays at 0%
   (all traffic on Nitro) until a deployment picks the new environment up, per
   [`apps/web/README.md`'s routing section](../web/README.md#collaboration-runtime-routing).
   The deprecated `NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL` alias still works, but
   as a `NEXT_PUBLIC_*` value it is inlined at build time and needs a full
   rebuild.

### Later deployments and secret rotation

Once the Worker exists, rebuild its workspace dependencies before deploying;
the Worker bundles their compiled `dist/` exports rather than their source:

```bash
pnpm exec turbo run build \
  --filter=@softmaple/collab-cloudflare... \
  --filter=!@softmaple/collab-cloudflare
pnpm --filter @softmaple/collab-cloudflare deploy
```

The deploy inherits its existing secrets and fails if a required binding is
missing.

For a controlled rotation, use `wrangler versions secret put <NAME>` (or
`wrangler versions secret bulk <FILE>` for several values) to create an
undeployed version. Before doing so, compare `wrangler deployments status` with
`wrangler versions list`: these commands derive the secret version from the
latest uploaded version, which may contain unrelated, undeployed code. Rotate
only when that latest version is the intended active base. Review the new
version, then explicitly activate its reported id with
`wrangler versions deploy <VERSION_ID>`. Do not revoke the old upstream
credential until the new version is active and verified.

`wrangler secret put` is an immediate-activation alternative only when the
latest version is already deployed. It creates and deploys a new version at
once, so it is not a config-only write and needs no later `wrangler deploy`.

## Rollback

To revert a bad deploy of the Worker itself (independent of the routing
decision — see below): `wrangler rollback` reverts to the previously active
version; `wrangler versions list` first if you need to roll back to a
specific, older version by id (`wrangler rollback <VERSION_ID>`). Repository CI
only exercises a dry run, so this procedure is not verified against account
state. Confirm it during the first managed Stage 2 deployment.

**Rollback can fail outright.** Cloudflare refuses it if a Durable Object
class lifecycle change (via `wrangler.jsonc`'s `migrations` array) happened
between the active version and the rollback target, or if the target
depends on a binding/resource that's since been modified or removed — both
apply directly here once `DOCUMENT_ROOMS`/`PRESENCE_ROOMS` accumulate more
than one migration entry. When `wrangler rollback` is refused for either
reason, fall back to **routing rollback** below (move documents back to
Nitro) rather than trying to force a Worker-level revert.

This is a different lever from **routing rollback** (moving documents back
to Nitro without touching what's deployed here) — see
[`apps/web/README.md`'s routing section](../web/README.md#collaboration-runtime-routing)
and
[`docs/design/collaboration-operations.md`](../../docs/design/collaboration-operations.md#rollback-procedure)
for that procedure and how the two levels relate.

## Verification

```bash
pnpm exec turbo run build \
  --filter=@softmaple/collab-cloudflare... \
  --filter=!@softmaple/collab-cloudflare
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
