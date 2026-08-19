---
title: Collaboration Runtime Operations
description: When to deploy Nitro vs. Durable Objects, environment/storage responsibilities, rollback procedures, and the current default-runtime decision.
---

# Collaboration Runtime Operations

This is the cross-runtime operational summary for the collaboration backend:
`apps/collab-nitro` (Nitro + Redis + Supabase Postgres, the repository-configured
default) and `apps/collab-cloudflare` (Cloudflare Durable Objects + Supabase
Postgres). See the repository docs for the full per-runtime picture:
[`apps/collab-nitro/README.md`](https://github.com/softmaple/softmaple/blob/next/apps/collab-nitro/README.md),
[`apps/collab-cloudflare/README.md`](https://github.com/softmaple/softmaple/blob/next/apps/collab-cloudflare/README.md),
and the runtime-independent
[`collaboration-runtime.md`](./collaboration-runtime.md) contract.

## When to deploy which runtime

**Nitro is the repository-configured routing default.** Every document resolves
to it unless explicit routing config says otherwise. See
[`apps/web/README.md`'s "Collaboration runtime routing"](https://github.com/softmaple/softmaple/blob/next/apps/web/README.md#collaboration-runtime-routing)
for the mechanism: the server-side `resolveCollabRuntime(documentId)` wrapper
reads environment config for each page render, then calls the pure
`decideCollabRuntime(documentId, config)` decision function.

**The repository is configured for Cloudflare test-only use.** It contains no
Cloudflare deployment workflow, and `wrangler.jsonc` declares no route or
custom domain. `COLLAB_CLOUDFLARE_WS_URL` (and its deprecated
`NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL` alias) is unset by default, so the web
routing fail-safe keeps every document on Nitro. Repository state
cannot prove what has been deployed manually or configured in the Cloudflare
dashboard; verify the target account before relying on this stage description.

| Stage | Description | Repository status |
| --- | --- | --- |
| 1 | Nitro = routing default, DO = test only | **Configured stage.** Local unit, app, and mocked adapter-conformance suites exercise the DO implementation; they do not prove a deployed Worker or production Supabase path. |
| 2 | DO = preview/internal environments | Not configured. It requires a reachable Worker, a deployed integration smoke test, and operational signals described below. |
| 3-5 | Small → expanded → full production cohort | Not ready. |

## Environment configuration

Each app owns its authoritative environment-variable table; this is a compact
summary:

| | Nitro (`apps/collab-nitro`) | Cloudflare (`apps/collab-cloudflare`) |
| --- | --- | --- |
| Durable event store | `DATABASE_URL` (direct Prisma/Postgres) | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (Supabase RPC) |
| Auth claims | `SUPABASE_URL` + publishable key | `SUPABASE_URL` + publishable key through Supabase Auth |
| Membership/profile lookups | `DATABASE_URL` (direct Prisma/Postgres) | `SUPABASE_URL` + service-role key through the Data API |
| Allowed browser origins | `COLLAB_ALLOWED_ORIGINS` | `COLLAB_ALLOWED_ORIGINS` |
| Live fan-out and presence | `COLLAB_REALTIME_DRIVER` (+ `REDIS_URL` on Vercel) | Durable Object-local; no Redis configuration |

Full tables:
[`apps/collab-nitro/README.md#environment`](https://github.com/softmaple/softmaple/blob/next/apps/collab-nitro/README.md#environment)
and
[`apps/collab-cloudflare/README.md#environment`](https://github.com/softmaple/softmaple/blob/next/apps/collab-cloudflare/README.md#environment).

Cloudflare needs `SUPABASE_SERVICE_ROLE_KEY`, an elevated server-only
credential. Durable event persistence uses the two event RPCs; authorization
and presence session hooks also use Supabase Auth and Data API queries for
documents, workspace memberships, and user profiles. Nitro instead holds a
direct Prisma connection to the same Postgres database and does not use the
service-role key. Verify all three Cloudflare access surfaces in the target
Supabase project; do not assume successful RPC access proves Auth or table
access.

## Storage responsibilities

### Supabase Postgres (durable event history shared by both runtimes)

Both document runtimes append and read the same durable event-history tables:
`document_event_batches` and `document_event_ids`. Moving a document between
runtimes therefore needs no **event-history** migration. Browser clients do not
write those tables. See
[`apps/collab-nitro/README.md#persistence`](https://github.com/softmaple/softmaple/blob/next/apps/collab-nitro/README.md#persistence)
and
[`packages/db/supabase/README.md`](https://github.com/softmaple/softmaple/blob/next/packages/db/supabase/README.md)
for the schema and access rules.

Presence is not part of this shared durable store. Nitro stores live presence
membership in Redis (or process memory in local development), while
Cloudflare stores it in `PresenceRoomDO`'s `ctx.storage`. A runtime handoff does
not migrate live members: after a reload or fresh page render, clients
authenticate and join the destination runtime's presence room again. Expect a
temporary leave/rejoin boundary, and never use presence as durable application
state.

The `documentEventStoreConformance` suites prove that each adapter maps the
shared append/read contract correctly against a test double. Nitro injects a
mock Prisma client; Cloudflare stubs `fetch` over an in-memory reference store.
They do **not** reach production Postgres, the real Supabase RPC functions, or a
deployed Worker. A Stage 2 gate must add and run a deployed integration smoke
test against the target Supabase project.

### Redis (Nitro only)

Redis owns distributed realtime pub/sub, presence TTLs, and connection leases,
never durable event history. Missed realtime messages recover through Postgres
and the repair/resync protocol. See
[`apps/collab-nitro/README.md#storage-roles`](https://github.com/softmaple/softmaple/blob/next/apps/collab-nitro/README.md#storage-roles).

Production and Preview Vercel deployments select Redis and never fall back to
process-local coordination. However, `REDIS_URL` validation is lazy: a missing
URL can pass build, startup, and the current `/health` liveness endpoint, then
fail when the first document or presence operation initializes realtime.
Deployment verification must check the variable and exercise a real WebSocket
handshake; `/health` alone is not a Redis-readiness check.

### Durable Objects (Cloudflare only)

`DocumentRoomDO` owns live document coordination, fan-out, and connection
limits. `PresenceRoomDO` separately owns live presence coordination and stores
presence membership in Durable Object storage so it survives hibernation.
Both rooms are routed on the upgrade request's query string
(`?documentId=`, `?roomId=`) and answer the browser with the object's own
upgrade response, so the Worker holds no long-lived collaboration socket and
every live connection hibernates with its object. Because no Worker-side
socket and no `setTimeout` survives that, both objects arm a Durable Object
alarm while a socket is still awaiting its first authentication message and
close it 1008 `Authentication timed out` at the deadline; `PresenceRoomDO`
shares that alarm with its presence-liveness sweep.
Neither object uses its storage as durable document-event history; that role
stays with Supabase Postgres. See
[`apps/collab-cloudflare/README.md#runtime-shape`](https://github.com/softmaple/softmaple/blob/next/apps/collab-cloudflare/README.md#runtime-shape)
and its Presence room section.

## Rollback procedure

There are two separate rollback levers:

1. **Routing rollback** stops new page renders from selecting Cloudflare.
   Reset `COLLAB_RUNTIME_OVERRIDE` and
   `COLLAB_CLOUDFLARE_ROLLOUT_PERCENT`, or clear `COLLAB_CLOUDFLARE_WS_URL`
   (and its deprecated `NEXT_PUBLIC_` alias), then rebuild and redeploy
   `apps/web`. Resetting only the override or percentage does not move ids on
   `COLLAB_CLOUDFLARE_DOCUMENT_ALLOWLIST`; clear that list, deny the affected
   ids, or clear the Worker URL to stop all new Cloudflare selections. See the
   [web routing procedure](https://github.com/softmaple/softmaple/blob/next/apps/web/README.md#collaboration-runtime-routing).
2. **Runtime deploy rollback** reverts the service code independently of web
   routing. Nitro uses the normal Vercel rollback. Cloudflare uses the
   [Worker rollback procedure](https://github.com/softmaple/softmaple/blob/next/apps/collab-cloudflare/README.md#rollback),
   subject to Durable Object migration and binding restrictions.

An automatic WebSocket reconnect does **not** re-run routing. The rendered
page keeps the collaboration target the server resolved for it, and reconnect
reopens the same runtime's endpoint. There is no cross-runtime failover: a
Cloudflare page whose endpoint is unreachable retries Cloudflare and never
falls back to Nitro. Only a reload or fresh page render can pick up changed
routing config.

This makes tabs split across two runtimes a correctness incident, not only a
UX issue. The two runtimes share durable event history but have no live
cross-runtime fan-out, shared connection ownership, or shared presence. A
config change can therefore leave old and new tabs concurrently writing the
same document through different owners until every old page is re-rendered.
Shared Postgres repair can reconcile durable history later; it does not make
concurrent ownership safe.

For any routing change that can affect active documents:

1. Stop rollout expansion and identify the affected document ids.
2. Prefer changing config while no affected editor is connected. Otherwise,
   coordinate a reload or close of every old tab; automatic reconnect is not
   sufficient.
3. Treat the handoff as incomplete until old-runtime connections are gone and
   reloaded clients have rejoined document and presence rooms on the selected
   runtime.
4. If split ownership is observed, keep the rollout stopped, drain/reload the
   old tabs, and verify durable repair before resuming.

## Correctness gates and rollback triggers

Both hosts currently write structured collaboration events only to their
console logs, and the log envelopes differ. There is no metrics backend,
retention guarantee, dashboard, alert, or percentile aggregation in this
repository. The events are queryable only if the hosting platform retains the
logs and an operator supplies runtime-specific queries.

| Gate | Evidence available today | Missing before it can be an operational trigger |
| --- | --- | --- |
| `EventConflictError` by conflict type | `event-conflict` log event with `conflictType` | Normalized aggregation, rate calculation, threshold, and alert |
| Runtime and authorization failures | Thrown room/backend failures can produce `event-error` or `message-error` logs | Expected authorization denials/revocations that return `null` and read-only `canWrite === false` rejections are not reported; origin rejection also occurs outside room metrics |
| Append and durable-ack timing | Per-operation `event-appended` and `event-acknowledged` duration samples | p50/p95/p99 aggregation and alerts; `event-acknowledged` records completion of the server send attempt, not confirmed client receipt |
| Repair/resync frequency and success | No success/frequency metric | Instrument repair requests, completion, retries, and failures |
| Adapter contract and append ordering | Local mocked conformance suites plus shared room state-machine tests | A deployed Worker/Supabase integration test and live signal |
| Cross-document isolation and single-runtime ownership | Shared room contract tests and Cloudflare's document/presence isolation test | No live cross-talk, active-owner, or split-runtime metric |
| Reconnect data loss and abnormal closes | Raw platform logs may help manually | Both transports discard close code/reason; no reconnect or abnormal-close metric |

None of these rows is an automated rollback trigger today. Before Stage 2
traffic, define log retention and normalized queries or export the events to a
metrics backend, set explicit thresholds, and add alerts. Until then, use the
local suites as pre-merge gates and a deliberate, retained-log review plus
deployed smoke tests as rollout gates.

## Known limitations and vendor-specific behavior

- Repository state shows no Cloudflare CD pipeline or declared route, but it
  cannot establish Cloudflare account or dashboard state.
- There are no normalized aggregates, alerts, latency percentiles,
  repair/resync success metrics, expected authorization-denial metrics,
  reconnect/close metrics, or active-room/connection gauges.
- There is no Postgres/Supabase query or transaction latency instrumentation
  inside either adapter.
- The mocked conformance suites cover `DocumentEventStore` only. Nitro's
  cross-instance Redis fan-out and Cloudflare's DO-local fan-out need
  host-specific integration coverage.
- Routing changes do not propagate to open tabs. A reload/fresh server render
  is required, and presence membership is recreated rather than migrated.
- On each constructor wake, `DocumentRoomDO` revalidates every attached socket
  against Supabase, up to the 100-connection room policy. Check the Workers
  plan's external-subrequest budget before changing that policy; see the
  [Cloudflare runtime shape](https://github.com/softmaple/softmaple/blob/next/apps/collab-cloudflare/README.md#runtime-shape).

## Current decision

**Not yet promotable to the default; keep repository routing at Stage 1.** The
repository contains no deployed-environment evidence, production metrics, or
real-store conformance result on which to base a promotion. To revisit this
decision:

1. Verify the target Cloudflare account state, then deploy a reachable Worker
   with the README's atomic first-deploy procedure.
2. Keep both mocked conformance suites and app suites as pre-merge checks, and
   add a deployed smoke/integration test that reaches the Worker, real Supabase
   RPCs, Auth, and required Data API tables.
3. Normalize and retain both hosts' events; add aggregation, p50/p95/p99
   latency, thresholds, alerts, and the missing authorization, repair,
   reconnect, and ownership signals.
4. Exercise preview/internal traffic only after protecting active documents
   from split ownership. Verify reload-based ownership handoff, presence
   rejoin, durable repair, and absence of old-runtime connections.
5. Compare a real traffic window with Nitro before expanding the cohort.

This document records what is required for Stage 2; it is not evidence that
Stage 2 has happened.
