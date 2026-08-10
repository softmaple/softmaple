---
title: Collaboration Runtime Contract
description: Runtime-independent document room, session, durability, fan-out, and repair semantics.
---

# Collaboration Runtime Contract

`@softmaple/collab-runtime` is the server-side semantic boundary between the
versioned collaboration protocol and concrete hosting infrastructure. It lets
the same room behavior be implemented on the current Nitro/Redis/Postgres
stack and on a future runtime without importing either environment into the
contract package.

This phase defines contracts only. The production route in `apps/collab`
continues to own the current behavior until it is migrated separately.

## Capability boundary

| Contract | Owns | Does not own |
| --- | --- | --- |
| `DocumentRoom` | Peer join/receive/leave/close state machine | WebSocket upgrade, raw JSON parsing, or convergence |
| `RoomPeer` | Sending validated server messages and closing a transport peer | Identity or authorization state |
| `DocumentSessionHooks` | Resolving and refreshing normalized access | Supabase/JWT implementation details |
| `DocumentEventStore` | Atomic durable append and ordered repair pages | Prisma/Postgres implementation details |
| `RoomFanout` | Committed document-event delivery across room instances | Presence or durable acknowledgement |
| `ConnectionLimiter` | Per-document admission and renewable leases | Redis or Durable Object implementation details |

The room consumes parsed `ClientCollabMessage` values and sends existing
`ServerCollabMessage` values. `DocumentEventPage` is derived from
`RepairResponseMessage`, so this layer cannot silently invent a second wire
shape.

## Ownership and lifecycle

A `DocumentRoom` represents one document. Its peer set is local to one room
instance; durable history, cross-instance fan-out, and global connection
admission arrive through shared capabilities. Two server instances may own
different local peer sets for the same document and communicate only through
those capabilities.

Document identity is exact and immutable. An Auth message must match
`DocumentRoom.documentId` before the authorization hook runs. Sessions,
event-store calls, and fan-out subscriptions use that same id, and a room must
discard a fan-out event for any other document. This is the cross-document
isolation boundary for path-routed rooms and Durable Objects alike.

`join` registers a transport peer. Authentication resolves a normalized
access record, and the room constructs the session using the validated
document id, session id, and protocol version from the Auth message. After
authentication, that session protocol version is authoritative for outbound
messages; later messages do not renegotiate it.

Authenticated sessions have an actor, role, and write flag. Public sessions
are protocol v3 only, anonymous, and always read-only. Authorization refresh
may update role/write access, but an access-mode or actor change revokes the
session instead of silently changing its identity.

Connection admission happens before `Ready`. A partially completed join must
release every acquired subscription and lease. `leave` and `close` must be
safe after partial setup and must release resources even when authorization
has already been invalidated. A lost lease or revoked authorization closes the
peer. Operations for one peer may arrive concurrently. The room synchronizes
their state transitions so receive/leave/close races cannot create two
sessions or leak partial resources, while an Auth observed during pending
authentication is still rejected.

The current compatibility policy is 100 physical connections per document, a
45-second lease TTL, and 15-second lease/authorization refresh. A
`DocumentRoomPolicy` supplies the connection values and authorization cadence;
`DEFAULT_DOCUMENT_ROOM_POLICY` records this compatibility baseline. Duplicate
admission refers to the server-generated physical peer id;
the client session id is correlation metadata and may be reused on reconnect.

| Peer state/input | Required outcome |
| --- | --- |
| Event or RepairRequest before Auth | Direct non-retryable `AuthenticationFailed`; no room mutation |
| A second Auth, including while Auth is pending | Close 1008; never create a second session |
| Auth denied (`authorize` returns `null`) | Non-retryable `AuthenticationFailed`, then close 1008 |
| Auth provider unavailable (`authorize` throws) | Retryable `AuthenticationFailed`; clean partial resources |
| Connection capacity or duplicate peer rejection | Retryable `Forbidden`, then close 1013 |
| Authorization revoked or lease refresh returns false | Close 1008 and clean room resources |
| Periodic authorization/lease provider failure | Close 1011 and clean room resources |

Origin validation, raw message byte limits, JSON parsing, and other
transport-measured policies remain host adapter responsibilities. Protocol
validation remains in `@softmaple/collab-protocol`. The adapter preserves the
current 256 KiB limit (close 1009), 120 messages per 10 seconds limit
(`InvalidMessage`, retryable, then close 1013), and malformed-message behavior
(`InvalidMessage`, non-retryable). Browser clients close on protocol Error and
reconnect only when it is retryable.

## Durable append and acknowledgement

`DocumentEventStore.append(documentId, actorId, batches)` has these
requirements:

1. The complete ordered request is atomic.
2. Appends for one document serialize across independent room/runtime
   instances; a process-local lock is insufficient.
3. Parent references may resolve to bootstrap, durable history, or an earlier
   event in the same request, never to a later event.
4. An exact `batchId` plus payload resend succeeds idempotently. Reusing an id
   for a different payload is a conflict.
5. Returned batch ids correspond to every input batch in input order and are
   returned only after durable commit.
6. The store rechecks write authorization inside the serialized durable
   boundary for every append; room-level cached authorization is not a
   substitute.

Store adapters translate infrastructure-specific failures into the runtime
taxonomy before they reach `DocumentRoom`:

| Runtime error | Protocol error | Retryable |
| --- | --- | --- |
| `DocumentEventAuthorizationError` | `Forbidden` | No |
| `DocumentEventConflictError` | `Conflict` | No |
| `DocumentEventStoreUnavailableError` | `PersistenceFailed` | Yes |

`DocumentEventConflictError.details.conflictType` uses the same four conflict
categories defined in the consistency document. A repair read can reject only
with `DocumentEventStoreUnavailableError`.

For a client Event message, the room ordering is:

```text
validate session/write access
        ↓
atomic durable append
        ↓
DurableAck to the origin
        ↓
publish the committed batches through RoomFanout
```

An append failure produces neither acknowledgement nor fan-out. An
acknowledgement means durable commit, not delivery to every replica. Fan-out
is best-effort after commit: a publish failure does not roll back the write or
invalidate the acknowledgement, and peers recover through repair. If the
origin disconnects before receiving its acknowledgement, an exact resend is
idempotent.

Fan-out contains document Event batches only. `Ready`, `DurableAck`, repair
responses, and errors are direct peer messages. Delivery includes the writer
and may be duplicated, delayed, lost, or reordered across publishers;
consumers deduplicate by batch id. A failed send to one local peer must not
prevent delivery to the remaining peers. `RoomFanout.publish` owns loopback as
well as cross-instance delivery; the room does not need a second local
broadcast path.

## Repair and resync

Repair is client-requested durable history synchronization:

- Start at cursor `"0"`. Every cursor is a non-negative decimal string.
- Read batches strictly after `afterCursor` in ascending durable order.
- Echo the request's `requestId` and return the page's `batches`,
  `nextCursor`, and `complete` fields only to that peer.
- Keep every page within `DOCUMENT_EVENT_PAGE_LIMIT` (currently 100 batches).
- An empty page preserves its input cursor. Every non-empty page strictly
  advances `nextCursor` to its final durable row. A page with
  `complete: false` is therefore non-empty; `complete` means that page read
  observed no later durable row.
- Keep public read-only repair available.
- Do not pause live fan-out while repair is active.

Repair pages are not a frozen snapshot. A committed live Event can arrive
before, after, or between pages and may duplicate a batch in a page. The
client's batch-id deduplication makes every supported interleaving converge.
The server does not maintain a hidden repair cursor or trigger blind repair on
every conflict.

On reconnect, the browser repairs to completion before it exact-resends its
pending write. That one-in-flight queue is a client invariant that the room
must remain compatible with; it is not server-owned session state.

## Not a convergence layer

`DocumentRoom` coordinates validated dispatch, authorization, durable
persistence, acknowledgement, repair, fan-out, connection policy, and
lifecycle. It never integrates rich-text operations or decides convergence.
EG-walker and `@softmaple/block-model` remain the only convergence/model
layers, and awareness remains an independent ephemeral channel.

The conflict categories and retry behavior that every runtime must preserve
are defined in
[`collaboration-consistency.md`](./collaboration-consistency.md).
