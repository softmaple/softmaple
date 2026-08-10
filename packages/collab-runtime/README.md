# `@softmaple/collab-runtime`

Runtime-independent contracts for hosted document collaboration. The package
owns room and session semantics while leaving every infrastructure choice to a
host adapter.

The public capabilities cover:

- `createDocumentRoom`, `DocumentRoom`, and transport-neutral `RoomPeer`
  lifecycle
- normalized authenticated and public document sessions
- durable event append and repair-page reads
- committed-event fan-out across room instances
- per-document connection admission and renewable leases
- runtime-neutral authorization, conflict, and store-unavailable failures

A `DocumentRoom` implementation must preserve the collaboration consistency
baseline: append before `DurableAck`, acknowledge before fan-out, never fan out
a failed append, keep repair compatible with interleaved live events, and rely
on the block model/EG-walker stack for convergence rather than implementing a
second CRDT.

Every capability call remains scoped to the room's immutable document id.
Repair cursors retain the existing non-negative decimal wire format, and store
adapters translate infrastructure errors into the exported runtime error
taxonomy before room logic maps them to protocol errors.

This package deliberately contains no Nitro, Redis, Prisma, Supabase,
Cloudflare Workers, editor-framework, React, routing, or UI integrations.
Concrete hosts compose the shared state machine with runtime-specific
capability adapters.
