---
title: Collaboration Runtime Operations
description: When to deploy Nitro vs. Durable Objects, environment/storage responsibilities, rollback procedures, and the current default-runtime decision.
---

# Collaboration Runtime Operations

This is the cross-runtime operational summary for the collaboration
backend: `apps/collab` (Nitro + Redis + Supabase Postgres, the current
production default) and `apps/collab-cloudflare` (Cloudflare Durable
Objects + Supabase Postgres). Where a per-app doc already owns a detail,
this page links to it rather than duplicating it — see
[`apps/collab/README.md`](../../apps/collab/README.md) and
[`apps/collab-cloudflare/README.md`](../../apps/collab-cloudflare/README.md)
for the full per-runtime picture, and
[`collaboration-runtime.md`](./collaboration-runtime.md) for the
runtime-independent semantic contract both hosts implement.

## When to deploy which runtime

**Nitro is the always-on production default.** Every document resolves to
it unless explicit routing config says otherwise — see
[`apps/web/README.md`'s "Collaboration runtime routing"](../../apps/web/README.md#collaboration-runtime-routing)
for the mechanism (`resolveCollabRuntime`, a pure function of
`(documentId, config)` evaluated server-side per page render).

**Cloudflare is test-only today.** It has never been deployed to a
reachable endpoint — no CD pipeline, no `routes`/custom domain in
`wrangler.jsonc`, only a manual `wrangler deploy` script (see "Production
deployment" in
[`apps/collab-cloudflare/README.md`](../../apps/collab-cloudflare/README.md)).
Routing's own fail-safe already accounts for this:
`NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL` is unset by default, so the routing
decision resolves to Nitro for every document regardless of the other
rollout variables until someone actually deploys the Worker and sets that
URL.

The current stage against the issue's own staged-rollout plan:

| Stage | Description | Status |
| --- | --- | --- |
| 1 | Nitro = production, DO = test only | **Current stage.** DO is exercised by `packages/collab-runtime`'s unit suite, both apps' own test suites, and the shared conformance suite below — never by real traffic. |
| 2 | DO = preview/internal environments | Not started — requires deploying the Worker to a reachable environment first. |
| 3-5 | Small → expanded → full production cohort | Not applicable yet. |

## Environment configuration

Each app owns its own authoritative env-var table; this is a compact
summary, not a replacement for either:

| | Nitro (`apps/collab`) | Cloudflare (`apps/collab-cloudflare`) |
| --- | --- | --- |
| Durable store connection | `DATABASE_URL` (direct Prisma/Postgres) | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (Supabase RPC) |
| Auth project | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` |
| Allowed browser origins | `COLLAB_ALLOWED_ORIGINS` | `COLLAB_ALLOWED_ORIGINS` |
| Realtime fan-out | `COLLAB_REALTIME_DRIVER` (+ `REDIS_URL` on Vercel) | none — DO-local, no external config |

Full tables: [`apps/collab/README.md#environment`](../../apps/collab/README.md#environment),
[`apps/collab-cloudflare/README.md#environment`](../../apps/collab-cloudflare/README.md#environment).

**The one genuine vendor asymmetry**: Cloudflare's adapter needs
`SUPABASE_SERVICE_ROLE_KEY` — an elevated, server-only credential —
because it reaches Supabase over RPC calls from the Worker. Nitro instead
holds a direct `DATABASE_URL` Prisma connection to the same Postgres
database and never touches that key at all. Neither is more or less
secure by design, but they are not interchangeable: don't assume a value
set for one runtime satisfies the other's requirement.

## Storage responsibilities

### Supabase (shared by both runtimes)

Durable event history (`document_event_batches`, `document_event_ids`)
and the presence backing store live in the same Supabase/Postgres
database for both runtimes — this is *why* the routing decision needs no
data migration when it moves a document between them (see
[`apps/collab/README.md#persistence`](../../apps/collab/README.md#persistence)
and [`packages/db/supabase/README.md`](../../packages/db/supabase/README.md)
for the schema and Data-API access rules). The shared
`documentEventStoreConformance` suite
(`packages/collab-runtime/src/testing/capability-conformance.ts`) is the
direct evidence that both adapters — Nitro's
`prismaDocumentEventStore` and Cloudflare's
`createSupabaseDocumentBackend(env).events` — honor the same append/read
contract against this shared store.

### Redis (Nitro only)

Distributed realtime pub/sub, presence TTLs, and connection leases —
never the durable store. A missed realtime message recovers through
Postgres plus the existing repair/resync protocol, not through Redis
persistence. See
[`apps/collab/README.md#storage-roles`](../../apps/collab/README.md#storage-roles).
Production and Preview Vercel deployments require Redis and fail fast if
it's missing; they never silently fall back to process-local
coordination.

### Durable Objects (Cloudflare only)

`DocumentRoomDO`/`PresenceRoomDO` own only live peer coordination,
fan-out, and connection limits inside one object — no Redis dependency,
and Durable Object SQLite storage is **not** used as event history (that
role stays with Supabase Postgres, above). See
[`apps/collab-cloudflare/README.md#runtime-shape`](../../apps/collab-cloudflare/README.md#runtime-shape).

## Rollback procedure

Two distinct levels — know which one you need before acting:

1. **Routing rollback** — moving documents back to Nitro without touching
   what's deployed. This is the lever for "stop sending traffic to
   Cloudflare" once it's live. Fully documented in
   [`apps/web/README.md`'s routing section](../../apps/web/README.md#collaboration-runtime-routing):
   reset `COLLAB_RUNTIME_OVERRIDE`/`COLLAB_CLOUDFLARE_ROLLOUT_PERCENT` to
   their safe defaults, or clear `NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL`
   entirely, and redeploy `apps/web`. **Resetting the override/percent
   alone does not move documents on `COLLAB_CLOUDFLARE_DOCUMENT_ALLOWLIST`
   — the allowlist takes precedence over the override.** To stop *all*
   Cloudflare traffic, either clear the allowlist (or move the affected
   ids to `COLLAB_CLOUDFLARE_DOCUMENT_DENYLIST`) or clear
   `NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL` entirely, which wins regardless
   of every other variable. **Already-open browser tabs don't observe any
   of this until they reconnect or reload** — read that section's
   coordinated-reload guidance before changing rollout config on a
   document with active editors.
2. **Runtime deploy rollback** — reverting what's actually running for a
   given service, independent of routing. For Nitro, this is a normal
   Vercel deployment rollback. For Cloudflare, see "Rollback" in
   [`apps/collab-cloudflare/README.md`](../../apps/collab-cloudflare/README.md) —
   this has never been exercised against a real deployment, since none
   exists yet.

## Correctness gates and rollback triggers

The issue's own gate list, and what's actually detectable today given
what's shipped so far:

| Gate | Detectable today? |
| --- | --- |
| `EventConflictError` rate by conflict type | **Yes.** `services.metrics` on both `DocumentRoomServices` implementations emits a typed `event-conflict` event (with `conflictType`) through the shared `report()` fan-in in `packages/collab-runtime/src/document-room-implementation.ts` — see both apps' `logDocumentMetric`/`logMetric` wiring. |
| Runtime errors / authorization failures | **Yes**, same mechanism — `event-error` / `message-error` events. |
| Append/durable-ack latency | **Yes.** `event-appended`/`event-acknowledged` events bracket `DocumentEventStore.append` and the `DurableAck` send. |
| Convergence failures, unexplained durable-history conflicts, missing committed events, incorrect durable acks | Partially — the conformance suite (`documentEventStoreConformance`) proves both adapters satisfy the same contract in isolation, and `packages/collab-runtime/test/document-room.test.ts`'s ~40 state-machine cases cover the shared append→ack→fan-out ordering. Neither is a live production signal; both are pre-merge gates. |
| Authorization isolation failures, document cross-talk | Only through the shared `DocumentRoom` contract's own invariants (document-scoped fan-out, no cross-document delivery) plus manual log inspection — **no automated cross-talk metric exists.** |
| Repair loops, reconnect data loss | **No automatic signal today.** Neither transport host reads the WebSocket close code/reason yet — Nitro's crossws `close` hook and Cloudflare's `webSocketClose` handler both discard it (a known limitation below), so reconnect-rate and abnormal-close-rate metrics don't exist. Watching this currently means reading raw logs, not alerting on a metric. |

Given the last two rows, treat any expansion past Stage 1 as requiring
manual log review during the exercised window, not just a metrics
dashboard — the automated signal is real but partial.

## Known limitations and vendor-specific behavior

- `apps/collab-cloudflare` has no CD pipeline and has never served
  production traffic — see "Production deployment" in its README.
- No reconnect-rate or abnormal-WebSocket-close-rate metrics yet; this
  needs new plumbing (reading the close code/reason from crossws and from
  Cloudflare's hibernatable `webSocketClose` handler), not just a new
  metric call — deferred deliberately rather than rushed.
- No active-rooms/active-connections gauges or Durable Object
  wake/hibernation counters — these need a periodic gauge or per-instance
  registry, a different shape of instrumentation than the event-driven
  metrics shipped so far.
- No Postgres/Supabase query/transaction latency instrumentation inside
  either adapter (`prisma-document-event-store.ts`,
  `supabase-backend.ts`) — independent of the shared room code, and not
  yet built.
- The shared conformance suite covers `DocumentEventStore` only.
  `RoomFanout` is deliberately not covered: Nitro's cross-instance Redis
  pub/sub and Cloudflare's single-instance DO-local fanout are
  architecturally different enough that forcing identical black-box
  conformance isn't the right test shape.
- Routing decisions don't propagate to already-open browser tabs — see
  the rollback section above.
- Cloudflare-specific: `DocumentRoomDO` revalidates every attached
  socket's access against Supabase on constructor wake, up to the
  100-connection room policy. This is a real per-wake cost budget; see
  "Runtime shape" in
  [`apps/collab-cloudflare/README.md`](../../apps/collab-cloudflare/README.md)
  for the Workers-plan subrequest-budget implication before lowering (or
  raising) that policy.

## Current decision

**Not yet promotable to default. Stage 1 only.** Cloudflare has no
production traffic and no deployment, so there is no data to base a
promotion decision on — recording an optimistic verdict without evidence
would be worse than recording none. What's needed to revisit this
decision, in order:

1. Deploy `apps/collab-cloudflare` to a reachable environment (see its
   README's "Production deployment" section for the current, manual
   process).
2. Exercise Stage 2 (preview/internal traffic) and confirm the shared
   conformance suite and both apps' test suites stay green against that
   deployment.
3. Collect the append/ack-latency and conflict/error-rate metrics this
   phase's instrumentation now makes possible, for a real traffic window,
   and compare them against Nitro's.
4. Close enough of the reconnect/close-code gap (above) to watch the
   remaining correctness gates before expanding past a small cohort.

Until then, this document's own existence is the operational readiness
work for Stage 2 — not evidence that Stage 2 has happened.
