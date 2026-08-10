---
title: Collaboration Consistency
description: Durable write invariants and EventConflictError semantics for Softmaple's hosted collaboration pipeline.
---

# Collaboration Consistency

This document records the **current** collaboration consistency model after
[#865](https://github.com/softmaple/softmaple/pull/865). It is a companion to
[`collaboration-layers.md`](./collaboration-layers.md) (layering) and
[`collaboration-models.md`](./collaboration-models.md) (engine contracts).

It describes what the Nitro/Postgres collaboration host and browser session
guarantee today. It is not an aspirational redesign and does not introduce a
`DocumentRoom` or Durable Objects runtime.

## Durable write invariants

These invariants are load-bearing. Consistency tests treat them as the
conformance baseline for future runtime hosts.

### 1. One causally dependent write in flight per client session

A browser document session keeps at most one durable `Event` write in flight.

- Later local edits stay **pending** until `DurableAck`.
- The outgoing queue preserves exact batch identity across disconnect.
- After reconnect, the session repairs first, then exact-resends pending
  batches.

Independent remote collaborators are unaffected; the queue is per session.

### 2. Per-document durable serialization

Same-document durable appends serialize through a Postgres
transaction-scoped advisory lock (`pg_advisory_xact_lock`). This works across
serverless instances that share the database.

### 3. Durable commit before DurableAck and fan-out

The server order is:

1. Validate and append batches in the locked transaction.
2. Send `DurableAck` to the writing peer.
3. Publish the `Event` on the realtime bus for local and remote peers.

If persistence fails, nothing is fanned out. If fan-out fails after commit,
peers recover through repair/resync.

### 4. Idempotent exact resend

Resending the same `batchId` with the same payload is a no-op success.
Resending the same `batchId` with a different payload is a conflict.

### 5. Repair is explicit synchronization

`RepairRequest` / `RepairResponse` pages catch clients up from a cursor over
durable history. Repair is intentional synchronization, not an automatic
reaction to every conflict.

Live `Event` messages may arrive during an incomplete repair. Clients apply
both paths with batch-id deduplication and must still converge.

### 6. Presence is not durable convergence

Awareness/presence remains ephemeral. It must not be mixed into EG-walker
document history or durable batch appends.

## EventConflictError semantics

On the **realtime** transport, conflicts are surfaced to clients as
non-retryable protocol `Error` messages with code `conflict`. The browser does
**not** enter a conflict-driven reconnect/retry loop. Missing history is
recovered on the next intentional repair/resync after a clean reconnect path,
not by blindly retrying the conflicting payload.

HTTP appends use a different surface. In `document-events.post.ts`,
`EventConflictError` maps to **HTTP 409** with an `{ error }` body (the conflict
message string only). Structured fields such as `missingParentIds` exist on the
server-side `EventConflictError` instance; they are not included in that HTTP
response. On the realtime route, the same details are written to server logs via
`logRouteError` as bounded samples and are not sent on the WebSocket `Error`
payload.

Implementation: `EVENT_CONFLICT_TYPE` / `EventConflictError` in
`apps/collab/server/utils/event-conflict.ts`.

### `DuplicateIncomingEventId`

| Field | Current behavior |
| --- | --- |
| Violated invariant | Event IDs inside one append request must be unique. |
| Expected cause | Malformed client payload or buggy batch packing. |
| Automatic retry safe? | No. |
| Repair/resync recover? | No for the bad request. A correct later submission can proceed. |
| Classification | Client misuse / protocol inconsistency. |
| Server behavior | Reject the request; no durable write; no fan-out. |
| Client behavior | Treat as fatal sync error for this write; do not reconnect-loop. |

### `MissingParentHistory`

| Field | Current behavior |
| --- | --- |
| Violated invariant | Every non-bootstrap parent must already be durable or appear earlier in the same causally ordered request. |
| Expected cause | Client sent a child before its parents were acknowledged; truncated history; or reversed batch order in one request. After #865, transient races from overlapping in-flight dependent writes should no longer reach this path. |
| Automatic retry safe? | No as a conflict-driven reconnect loop. |
| Repair/resync recover? | Yes, once parents are durable: repair catches the client up, then an exact pending resend can succeed. |
| Classification | Synchronization gap (or client misuse if parents were never created). |
| Server behavior | Reject the request; structured details include `missingParentIds`. |
| Client behavior | Non-retryable conflict close. Next intentional connect repairs, then exact-resends pending batches. |

### `BatchPayloadConflict`

| Field | Current behavior |
| --- | --- |
| Violated invariant | A `batchId` identifies exactly one payload forever. |
| Expected cause | Client reused a batch id with different event contents. |
| Automatic retry safe? | No. |
| Repair/resync recover? | No for the conflicting payload. Durable history keeps the original. |
| Classification | Client misuse / protocol inconsistency. |
| Server behavior | Reject the request; no overwrite of durable history. |
| Client behavior | Fatal for that write identity; do not mutate and retry under the same id. |

### `StoredEventIdConflict`

| Field | Current behavior |
| --- | --- |
| Violated invariant | Event IDs are unique in durable document history. |
| Expected cause | Distinct batches claiming the same event id, or a unique-constraint race that fails post-commit verification. |
| Automatic retry safe? | No when verification shows a real id clash. Exact duplicate batch resend is handled separately and succeeds idempotently. |
| Repair/resync recover? | Repair can load authoritative history. The conflicting new payload must not be forced in. |
| Classification | Protocol inconsistency or durable-history integrity failure. |
| Server behavior | After P2002, verify whether the request is an exact duplicate; otherwise reject with this conflict type. |
| Client behavior | Non-retryable conflict; inspect/repair rather than blind resend of a different payload. |

## Multi-instance ownership model

The consistency harness models the intended ownership boundary:

```text
instance A
  local peers
  local topic/room state
        |
shared distributed bus + durable event store
        |
instance B
  local peers
  local topic/room state
```

Process-local hubs must not accidentally share peer sets. Cross-instance
delivery happens only through the shared bus after durable commit.

## Conformance coverage

Phase 1 hardening tests live under `apps/collab/test/`:

- `repair-live-interleave.test.ts` — repair ↔ live Event races
- `multi-instance-collab.test.ts` — write / repair / reconnect across instances
- `collaboration-convergence.property.test.ts` — seeded randomized 2–3 client traces

Optional soak:

```bash
COLLAB_CONVERGENCE_SOAK=1 pnpm --filter @softmaple/collab test
```
