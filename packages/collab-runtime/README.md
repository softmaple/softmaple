# `@softmaple/collab-runtime`

Runtime-independent semantics and contracts for hosted document collaboration.
The package owns the concrete room/session state machine while leaving every
infrastructure choice to a host adapter.

## Architecture

```text
      apps/collab-nitro                        apps/collab-cloudflare
   Nitro · Redis · Prisma                      Worker · Durable Object
              │                                           │
              └─────────────────────┬─────────────────────┘
                                    │
                        @softmaple/collab-runtime
                                    │
              ┌─────────────────────┴─────────────────────┐
              │                                           │
        DocumentRoom                                PresenceRoom
     RoomPeer lifecycle                        PresencePeer lifecycle
    sessions · admission                        payload-opaque codec
              │                                           │
         EventStore                                 PresenceStore
    append · repair pages                          TTL membership
         RoomFanout                                PresenceFanout
      committed fan-out                           broadcast fan-out
              │                                           │
              └─────────────────────┬─────────────────────┘
                                    │
                       @softmaple/collab-protocol
                     the messages rooms answer with
```

`EventStore`, `RoomFanout`, `PresenceStore`, and `PresenceFanout` are
**capability interfaces**, not implementations. Redis and Durable Objects sit
behind the same four seams, which is why both hosts can be proven equivalent by
one conformance kit instead of by two parallel test suites.

The two rooms never share a capability instance: presence outages cannot take
document persistence with them, and vice versa.

The public capabilities cover:

- `DocumentRoom` and transport-neutral `RoomPeer` lifecycle
- normalized authenticated and public document sessions
- durable event append and repair-page reads
- committed-event fan-out across room instances
- per-document connection admission and renewable leases
- runtime-neutral authorization, conflict, and store-unavailable failures
- `PresenceRoom` and transport-neutral `PresencePeer` lifecycle, built on a
  payload-opaque `PresenceCodec` seam so this package never imports
  `@softmaple/awareness`
- TTL-backed presence membership (`PresenceStore`) and presence broadcast
  fan-out (`PresenceFanout`), sharing no capability instance with
  `DocumentRoom`

A `./testing` subpath ships a dependency-free conformance kit (assertion
library free, so it stays inside the same host-infrastructure-free import
allowlist) that both the Redis-backed and Durable-Object-backed adapters run
against to prove equivalent behavior.

`createDocumentRoom` preserves the collaboration consistency baseline: append
before `DurableAck`, acknowledge before fan-out, never fan out a failed append,
keep repair compatible with interleaved live events, and rely on the block
model/EG-walker stack for convergence rather than implementing a second CRDT.

Every capability call remains scoped to the room's immutable document id.
Repair cursors retain the existing non-negative decimal wire format, and store
adapters translate infrastructure errors into the exported runtime error
taxonomy before room logic maps them to protocol errors.

This package deliberately contains no Nitro, Redis, Prisma, Supabase,
Cloudflare Workers, editor-framework, React, routing, or UI integrations. The
production collaboration app wires the runtime to those host concerns through
adapters under `apps/collab-nitro/server/adapters`.
