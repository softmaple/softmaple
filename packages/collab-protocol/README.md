# `@softmaple/collab-protocol`

The versioned wire contract between a browser collaboration client and any
collaboration host. This package is pure value semantics: message shapes, a
protocol version, an error taxonomy, and two runtime parsers. It contains no
transport, no persistence, no authorization, and no editor code, so both
runtimes and every client speak one identical format.

## Role in the stack

```text
       apps/web · apps/playground            apps/collab-nitro
            browser collab client         apps/collab-cloudflare
                     │                               │
                     │      Event / RepairRequest    │
                     ├──────────────────────────────►│
                     │  Ready / Event / DurableAck   │
                     │◄──────────────────────────────┤
                     │                               │
                     └───────────────┬───────────────┘
                                     │
                       @softmaple/collab-protocol
              versioned envelope · runtime validation · errors
                                     │
                        @softmaple/block-model
                  parseRichTextEventBatch (payload guard)
                                     │
                         @softmaple/eg-walker
                        events the batches carry
```

Both ends validate: a client parses what the server sent, a server parses what
the client sent. Neither side trusts a raw frame, and neither side hand-rolls a
second decoder.

| Layer | May import this package |
| --- | --- |
| `@softmaple/collab-runtime` | yes — it maps room results onto these messages |
| `apps/collab-nitro`, `apps/collab-cloudflare` | yes |
| `apps/web`, `apps/playground` | yes |
| `@softmaple/eg-walker`, `@softmaple/block-model` | **no** — lower layers |
| `@softmaple/awareness` | **no** — presence has its own protocol |

## Message flow

```text
client ──► Auth            { credential, documentId, sessionId }
server ──► Ready           { accessMode, documentId, userId, role, canWrite }

client ──► Event           { batches }
server ──► DurableAck      { batchIds }        after the durable append
server ──► Event           { batches }         fan-out to other peers

client ──► RepairRequest   { requestId, afterCursor }
server ──► RepairResponse  { requestId, batches, nextCursor, complete }

server ──► Error           { code, message, retryable }
```

`DurableAck` is only sent once the append succeeded, so a client can treat an
acknowledged batch id as durable. Repair pages are ordered and resumable
through `nextCursor`, and `complete` marks the last page.

## Versions

| Constant | Value | Notes |
| --- | --- | --- |
| `COLLAB_PROTOCOL_VERSION` | `3` | Current. `Auth` carries a `CollabCredential`; `Ready` carries `accessMode` and nullable `userId` / `role`. |
| `LEGACY_COLLAB_PROTOCOL_VERSION` | `2` | Accepted for compatibility. `Auth` carries a bare `accessToken`; `Ready` requires a non-null `userId` and `role`. |

Version 3 adds public (unauthenticated) read access. A `public` session must
report `userId: null`, `role: null`, and `canWrite: false`; `parseServerCollabMessage`
rejects a `Ready` that claims otherwise, so a host cannot accidentally grant
write capability to an anonymous reader.

## API

```ts
import {
  COLLAB_PROTOCOL_VERSION,
  COLLAB_MESSAGE_TYPE,
  COLLAB_ERROR_CODE,
  parseClientCollabMessage,
  parseServerCollabMessage,
  type ClientCollabMessage,
  type ServerCollabMessage,
} from "@softmaple/collab-protocol";

// Host side: never act on an unvalidated frame.
const message: ClientCollabMessage = parseClientCollabMessage(
  JSON.parse(raw),
);

// Client side: never render an unvalidated frame.
const reply: ServerCollabMessage = parseServerCollabMessage(
  JSON.parse(raw),
);
```

Both parsers throw a plain `Error` on anything malformed; they never return a
partially-trusted object. Callers translate that throw into an
`InvalidMessage` protocol error (hosts) or a transport failure (clients).

### Error codes

| Code | Meaning |
| --- | --- |
| `authentication-failed` | Credential rejected, or the `Auth` document id does not match the routed room |
| `forbidden` | Authenticated but not permitted (role, membership, or read-only session) |
| `invalid-message` | Frame failed validation |
| `conflict` | Durable append conflicted with existing history |
| `persistence-failed` | Durable store unavailable; `retryable` distinguishes transient failures |

## Validation limits

Bounds are part of the contract, not host policy, so every runtime enforces the
same ones:

- `Event.batches`: 1–64 batches per message.
- `RepairResponse.batches`: 0–100 batches per page.
- Repair cursors (`afterCursor`, `nextCursor`): non-negative decimal strings
  (`/^\d+$/`) — never numbers, so large cursors survive JSON round-trips.
- Each batch is validated through `parseRichTextEventBatch` from
  `@softmaple/block-model`; this package never inspects event internals itself.

## Commands

```bash
pnpm --filter @softmaple/collab-protocol build
pnpm --filter @softmaple/collab-protocol test
pnpm --filter @softmaple/collab-protocol typecheck
pnpm --filter @softmaple/collab-protocol lint
```

## Related

- Room and session semantics: [`@softmaple/collab-runtime`](../collab-runtime/README.md)
- Layer boundaries: [`docs/design/collaboration-layers.md`](../../docs/design/collaboration-layers.md)
- Durable-write invariants: [`docs/design/collaboration-consistency.md`](../../docs/design/collaboration-consistency.md)
- Presence protocol (separate, versioned independently): [`@softmaple/awareness`](../awareness/README.md)
