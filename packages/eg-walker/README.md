# @softmaple/eg-walker

Eg-walker implementation for collaborative plain-text editing, based on
["Collaborative Text Editing with Eg-walker: Better, Faster, Smaller"](https://arxiv.org/abs/2409.14252).

## Architecture

The package is organized around the paper's prepare/effect model:

```text
           local edit                                 remote events
      applyLocalOperation()                        applyRemoteEvents()
                │                                           │
                └─────────────────────┬─────────────────────┘
                                      │
                           core/ — EgWalkerReplica
                      public API · replay coordination
                                      │
                ┌─────────────────────┴─────────────────────┐
                │                                           │
             graph/                                      engine/
      persistent event DAG                        prepare/effect state
        frontier versions                          ranked B-tree index
    causal diff · topo order                       delete-target index
      columnar codec (§3.8)                       critical checkpoints
                │                                           │
                └─────────────────────┬─────────────────────┘
                                      │
                                document text
                        serialize() · native snapshot
```

- `graph/`: persistent event graph, frontier versions, causal expansion/diff, columnar codec.
- `engine/`: prepare/effect replay state, ranked B-tree index mapping, critical checkpoints, partial replay.
- `core/`: public API and thin walker coordinator.
- `types/`: public TypeScript types.

The event graph is the canonical durable state. The engine's replay records are
derived: they can be discarded at a critical version and rebuilt, which is what
makes partial replay possible. A native snapshot may additionally persist that
derived cache for faster restore, but it never replaces the graph as the source
of truth. `graph/` never imports `engine/`.

### Position in the wider stack

```text
   @softmaple/binding-lexical ──► @softmaple/block-model ──► @softmaple/eg-walker
        Lexical projection          blocks · marks · text        this package
                                             │
                                  RichTextEventBatch on the wire
                                             │
                                  @softmaple/collab-protocol
```

Surfaces never import this package directly — they go through a surface
binding. This package must not import an editor framework, awareness, or any
host runtime; see
[`docs/design/collaboration-layers.md`](../../docs/design/collaboration-layers.md).

The portable `serialize()` format contains plain text plus the event graph and
does not persist CRDT replay records. `EgWalkerReplica` does cache an engine
between edits, and the optional native-snapshot API can persist that cache for
faster restore; those are implementation extensions rather than the paper's
minimal persistent-state model. `createNativeSnapshot()` defaults to reusing
only resume state that is already available, so taking a snapshot never causes
an implicit full-history replay. Pass `{ resumeCache: "none" }` to exclude the
complete extension (including checkpoints), or `{ resumeCache: "rebuild" }`
to explicitly rebuild missing sequence/delete state.

### Paper compatibility boundary

The event-graph walk, numeric prepare/effect state machine, ranked sequence,
delete-target index, critical-version partial replay, and columnar event-graph
codec map directly to Sections 3.2–3.8 of the paper. The package deliberately
has a few different engineering boundaries:

- Public indexes and record contents use JavaScript UTF-16 code units. The
  paper defines one event per Unicode scalar value; a package event may instead
  contain a multi-code-unit insert or range delete.
- The replica retains its replay engine for fast incremental edits and keeps up
  to 32 materialized critical checkpoints. The paper permits discarding this
  internal CRDT state at critical versions.
- The ordinary in-memory event graph is an object graph. The binary columnar
  representation is used at the codec boundary, not as the live query engine.
- `FugueOrderIndex` provides logarithmic indexed integration in production;
  the original linear scan remains only as a differential-test oracle.

Treat `serialize()` as the paper-aligned state boundary and the columnar codec
as the Section 3.8 physical encoding. Native snapshots and retained runtime
caches are optional performance extensions.

## Usage

```typescript
import { createEgWalkerReplica, OPERATION_TYPE } from "@softmaple/eg-walker";

const replica = createEgWalkerReplica("replica-1");

replica.applyLocalOperation({
  type: OPERATION_TYPE.INSERT,
  index: 0,
  text: "Hello, World!",
});

replica.applyLocalOperation({
  type: OPERATION_TYPE.DELETE,
  index: 7,
  length: 6,
});

console.log(replica.getText()); // "Hello, !"

const serialized = replica.serialize();
```

## Opening a portable snapshot

`EgWalkerReplica.fromPortableSnapshot` returns in a few milliseconds. It
checks the snapshot header and serves the text, but leaves the event graph
encoded. Before the replica can apply an edit or a remote event, it has to
decode the graph and, unless the snapshot is trusted, replay the whole history
once to prove that the text matches it. That proof costs about as much as a
cold load of the history: 0.2–3 s on the paper traces. Run it before the user
can type:

```typescript
const codec = new PortableSnapshotCodec();
const replica = EgWalkerReplica.fromPortableSnapshot(
  codec.decode(bytes),
  replicaId,
);
showReadOnly(replica.getText());
await replica.prepare();
enableEditing(); // edits now cost what they cost on a live replica
```

`prepare()` works in slices of about 8 ms (`sliceMs`) and yields to the host
between them (`yieldToHost`; by default `scheduler.yield()`, `setImmediate`, a
`MessageChannel` message or `setTimeout`), so it does not hold up input or
rendering. Text reads work while it runs. An edit or remote event that arrives
first does the remaining work synchronously, as it would without `prepare()`,
and the promise settles with it. A snapshot whose text does not match its
history makes `prepare()` reject before any local event is created, and the
replica stays as restored. Pass `signal` to stop preparing, for example when
the document closes. `isPrepared()` tells whether the work is done.

The proof, and the replay state it leaves, belong to the JavaScript realm that
ran it. It cannot run in a Worker and be handed to the main thread. To keep it
off the main thread, host the replica itself in a Worker, where
`prepare({ sliceMs: Infinity })` prepares in one task, and send it operations.

### Trusted snapshots

A snapshot created from live state in this process, and bytes encoded from
one, are trusted and skip the proof. To keep that across reloads for
snapshots the app wrote itself, authenticate the bytes with an HMAC key the app
holds:

```typescript
// Once: a non-extractable key, kept with the app's local storage.
const key = await crypto.subtle.generateKey(
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"],
);

// Save.
const bytes = codec.encode(replica.createPortableSnapshot());
const tag = await codec.authenticate(bytes, key);
await store.put(documentId, { bytes, tag });

// Open.
const saved = await store.get(documentId);
const restored = EgWalkerReplica.fromPortableSnapshot(
  await codec.decodeAuthenticated(saved.bytes, saved.tag, key),
  replicaId,
);
await restored.prepare(); // decodes the graph; no proof replay
```

`authenticate` tags only proven snapshots: it replays bytes it did not encode
in this process first, and rejects them if their text does not match.
`decodeAuthenticated` rejects changed bytes, a changed tag, or another key;
such bytes can still be opened as untrusted with `decode`. Bytes from anywhere
else, such as a server or another device, stay untrusted and are proven in
full.

## Main APIs

Stable surface (`@softmaple/eg-walker`):

- `EgWalkerReplica` / `createEgWalkerReplica`: public index-based editing API.
- `PortableSnapshotCodec`: EGWP1 bytes for portable snapshots, with optional
  HMAC authentication for snapshots the app wrote itself.
- `ReplayWalker`: one-shot graph replay coordinator.
- `EventGraph`: persistent event DAG.
- `OPERATION_TYPE` and TypeScript types.

Internal replay primitives (`@softmaple/eg-walker/internal`, not covered by semver):

- `EgWalkerEngine`: prepare/effect replay engine.
- `ColumnarEventGraphCodec`: run-length encoded columns with varints and LZ4-compressed inserted content.
- `CriticalVersionAnalyzer`: critical checkpoint detection.
- `PartialReplayManager`: replay from checkpoint text/version.
- `IndexedSequence`: ranked B-tree backing the engine.

## Development

```bash
pnpm --filter @softmaple/eg-walker test
pnpm --filter @softmaple/eg-walker typecheck
pnpm --filter @softmaple/eg-walker build
pnpm --filter @softmaple/eg-walker lint
```

## Validation

### Property / fuzz tests

Property tests live in `src/test/property/` and use
[fast-check](https://fast-check.dev/) for shrinkable counterexamples.
They run as part of the normal test suite:

```bash
# Default — 100 runs per property (suitable for CI).
pnpm --filter @softmaple/eg-walker test

# Run only property tests.
pnpm --filter @softmaple/eg-walker test -- --run src/test/property

# Increase runs for a deeper sweep before a release.
EG_WALKER_PROPERTY_RUNS=500 pnpm --filter @softmaple/eg-walker test
```

| Property                                                   | File                                             |
| ---------------------------------------------------------- | ------------------------------------------------ |
| Multi-replica convergence under randomized delivery        | `convergence.property.test.ts`                   |
| Delivery-order invariance for a fixed event set            | `delivery-order-invariance.property.test.ts`     |
| Duplicate event delivery is idempotent                     | `duplicate-event-idempotency.property.test.ts`   |
| Missing-parent events are buffered then flushed            | `missing-parent-buffering.property.test.ts`      |
| JSON serialize / columnar codec round-trip                 | `serialize-roundtrip.property.test.ts`           |
| UTF-16 surrogate safety                                    | `unicode-surrogate.property.test.ts`             |
| Concurrent same-index inserts converge (YATA tie-breaking) | `concurrent-same-index-inserts.property.test.ts` |
| Long offline branch merge converges                        | `long-offline-branch-merge.property.test.ts`     |
| `applyRemoteEvent` position operation splice contract      | `apply-remote-event-result.property.test.ts`     |
| Event graph `diffVersions` matches causal-set differences  | `event-graph-diff.property.test.ts`              |

See [`src/test/property/README.md`](src/test/property/README.md) for how to add new properties.

### Benchmarks

Standalone performance harnesses live in the sibling
[`@softmaple/bench`](../bench/README.md) package,
keeping benchmark code and dependencies outside this production package.

```bash
pnpm exec turbo run bench --filter=@softmaple/bench
```

The benchmark package also owns the paper-aligned dataset harness and its
[measurement guide](../bench/PAPER_BENCHMARKS.md).

## References

- [Research paper](https://arxiv.org/abs/2409.14252)
- [Implementation guide](./IMPLEMENTATION_GUIDE.md)
