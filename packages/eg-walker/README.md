# @softmaple/eg-walker

Eg-walker implementation for collaborative plain-text editing, based on
["Collaborative Text Editing with Eg-walker: Better, Faster, Smaller"](https://arxiv.org/abs/2409.14252).

## Replay diagnostics

`replica.getReplayStats()` distinguishes completed work from retained state:

- `fullReplayEvents` and `partialReplayEvents` count every event visited by
  live full/suffix replays, including chains applied directly to the text.
  `replayedEvents` is their sum plus `snapshotValidationEvents`. Incremental
  applies are counted separately. Compare before/after values to measure an edit.
- `lifetimeRetreats`, `lifetimeAdvances`, and the other `lifetime*` work counters
  include engines used by live replays and snapshot validation, even temporary
  engines discarded within a replay
  and engines released at a confirmed critical cut or byte budget. Successful snapshot
  validation contributes its engine work once when the replica adopts it.
- `replayCacheEvictions` counts retained engines released by cache policy or a
  linear batch of more than 4,096 events; replacing an engine during replay is not an eviction. `replayCacheBudgetRefusals` counts byte-budget
  refusals, including a newly built engine that was never retained. A budget
  eviction increments both; a critical-cut release increments only evictions.
  `replayCacheBudgetBytes` is the current adaptive budget.
- `replayCacheEvents` and `replayCacheBytes` describe the cache retained **now**;
  neither measures work. `currentEngineStats` describes only the retained engine
  and is `null` without one. Legacy flat engine/Fugue/sequence counters preserve
  their previous current-engine or latest-replay scope for compatibility.

These diagnostics are local to a replica instance and are not persisted.
Rejected transactions restore their previous counters, so the totals describe
committed work rather than CPU time spent on failed attempts or recovery.

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
   packed prefix · TailEventLog                    ranked B-tree index
        frontier versions                          delete-target index
    causal diff · topo order                      critical checkpoints
   EGW4 columnar codec (§3.8)
                │                                           │
                └─────────────────────┬─────────────────────┘
                                      │
                                document text
                     portable snapshot · native snapshot
```

- `graph/`: persistent event graph stored as columns, frontier versions, causal expansion/diff, EGW4 columnar codec.
- `engine/`: prepare/effect replay state, ranked B-tree index mapping, critical checkpoints, partial replay.
- `core/`: public API and thin walker coordinator.
- `types/`: public TypeScript types.

The event graph is the canonical durable state. The engine's replay records are
derived: they can be discarded at a critical version and rebuilt, which is what
makes partial replay possible. A native snapshot may additionally persist that
derived cache for faster restore, but it never replaces the graph as the source
of truth. `graph/` never imports `engine/`.

A replica keeps the engine of its last replay for later concurrent events and
releases it at a critical version once it holds more than 4,096 events. A
frontier of one event is critical only among the events the replica holds,
though: under sustained concurrency a peer that has not seen it yet sends a
concurrent edit, and after a release only a replay of the whole history can
rebuild the engine. So the engine is released only at a confirmed cut, once
every author of its events has sent an event that follows the cut, or the
1,024 events after it all follow it.

### Event graph storage

The event graph keeps no object per event. Its events, numbered by insertion
rank, are stored in two parts:

- A packed prefix: immutable columns decoded from EGW4 bytes, or built from
  the first batch of remote events an empty graph receives. While the whole
  history is one exact causal chain, later chains extend these columns in
  place.
- `TailEventLog`, after the prefix: every other event, such as local edits,
  remote events and later batches. Appending an event copies each field into
  typed columns: its ID into per-replica runs, its operation into numeric
  columns, its inserted text into chunks of about 4,096 code units and its
  parents into insertion ranks. The numeric columns seal every 1,024 events
  into constant-step spans, with literal blocks for irregular values, so a
  local keystroke retains a few dozen bytes.

Large causal batches prepare the same sealed columns in `finish()` and
transfer them after the receive commits; replay uses dense columns until then.
Random reads decode individual spans, suffix replay reads only its suffix, and
full repacking can materialize dense columns again. Reading an event, for
example through `getEvent`, `exportEventGraph` or `serialize()`, builds a
`GraphEvent` from the columns; an order a caller asks for, such as
`getTopologicalOrder()`, keeps its events until the graph changes. None of
this changes the EGW4 wire format.

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

### Persistent state

Store a document as a portable snapshot. `createPortableSnapshot()` holds the
plain text and the event graph, `PortableSnapshotCodec` encodes it as EGWP1
bytes with the graph in EGW4, and `EgWalkerReplica.fromPortableSnapshot` opens
it again (see [Opening a portable snapshot](#opening-a-portable-snapshot)). It
does not persist CRDT replay records. On the paper's keystroke traces, the
EGW4 graph a snapshot holds is 1.01–1.06× the size of Diamond Types' `.dt`
files on the sequential and asynchronous traces and 1.18–1.28× on the
concurrent ones; see
[`PAPER_BENCHMARKS.md`](../bench/PAPER_BENCHMARKS.md#json-serialize-payloads).

`EgWalkerReplica` does cache an engine between edits, and the optional
native-snapshot API can persist that cache for faster restore; those are
implementation extensions rather than the paper's minimal persistent-state
model. `createNativeSnapshot()` defaults to reusing only resume state that is
already available, so it does not replay the history to rebuild missing resume
state. It still needs the decoded history: on a restored replica that is not
prepared yet, it first runs the preparation synchronously, which for an
untrusted portable snapshot includes the proof replay (see
[Opening a portable snapshot](#opening-a-portable-snapshot)). Await `prepare()`
first to do that work in slices.
Pass `{ resumeCache: "none" }` to exclude the complete extension
(including checkpoints), or `{ resumeCache: "rebuild" }` to explicitly rebuild
missing sequence/delete state. The snapshot holds the live graph encoded once as
EGW4; its `eventGraph` objects are decoded only when read, and
`NativeSnapshotCodec.encode` writes those bytes without rebuilding the graph
while the snapshot is unchanged. A snapshot built or edited outside the replica
has its `eventGraph` rebuilt and checked first.

`serialize()` and `deserialize()`, on `EgWalkerReplica` and on `EventGraph`,
write and read JSON: the text and one object per event, with its ID, its
parents' IDs, its operation and its timestamp. Use JSON for debugging, tests
and interop with tools that read it, on small documents, not for storage. On
the paper traces it takes 122–459 MB, about 190–200 bytes per keystroke and
150–600 times the EGW4 graph, and building it creates an object for every
event. S3's 459 MB is 85% of the longest string V8 can build, so a somewhat
longer history cannot be serialized at all. `EgWalkerReplica.deserialize()`
also replays the whole history.

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
- The live event graph is stored as columns, not only encoded as them: a
  packed prefix followed by `TailEventLog` (see
  [Event graph storage](#event-graph-storage)).
- Concurrent inserts are placed by the paper's linear scan, within a budget
  of two probes per sequence record. A scan that would overrun it builds
  `FugueOrderIndex`, which places every later insert of that replay in
  logarithmic time, so many concurrent inserts at one position stay
  O(n log n). The unbounded scan remains as a differential-test oracle.

Treat the portable snapshot as the paper-aligned state boundary and EGW4 as
the Section 3.8 physical encoding. Native snapshots and retained runtime
caches are optional performance extensions, and JSON `serialize()` is a
debugging format.

## Usage

```typescript
import {
  createEgWalkerReplica,
  OPERATION_TYPE,
  PortableSnapshotCodec,
} from "@softmaple/eg-walker";

const replica = createEgWalkerReplica("replica-1");

replica.applyLocalOperation({
  type: OPERATION_TYPE.INSERT,
  index: 0,
  text: "Hello, World!",
});

replica.applyLocalOperation({
  type: OPERATION_TYPE.DELETE,
  index: 7,
  length: 5,
});

console.log(replica.getText()); // "Hello, !"

// Save the text and its history as EGWP1 bytes.
const bytes = new PortableSnapshotCodec().encode(
  replica.createPortableSnapshot(),
);
```

## Opening a portable snapshot

`EgWalkerReplica.fromPortableSnapshot` returns in a few milliseconds. It
checks the snapshot header and serves the text, but leaves the event graph
encoded. Before the replica can apply an edit or a remote event, it has to
decode the graph and, unless the snapshot is trusted, replay the whole history
once to prove that the text matches it. That proof costs about as much as a
cold load of the history: 0.2–1.5 s on the paper traces. Run it before the user
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
rendering. A slice ends after the step that reaches its deadline, so it can
run over: on the paper traces the longest task is 19–64 ms. Text reads work
while it runs. An edit or remote event that arrives first does the remaining
work synchronously, as it would without `prepare()`, and the promise settles
with it. A snapshot whose text does not match its history makes `prepare()`
reject before any local event is created, and the replica stays as restored.
Pass `signal` to stop preparing, for example when the document closes.
`isPrepared()` tells whether the work is done.

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
- `IndexedSequence`: ranked B-tree backing the engine. Its items carry the
  leaf that holds them (`IndexedSequenceItem`), so an item belongs to at most
  one live sequence at a time.

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
pnpm --filter @softmaple/eg-walker test --run src/test/property

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
