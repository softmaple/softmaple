# Eg-walker Paper Conformance and Performance Plan

## Purpose

Bring `@softmaple/eg-walker` into semantic and asymptotic alignment with
"Collaborative Text Editing with Eg-walker: Better, Faster, Smaller" while
retaining clearly labelled engineering extensions that improve the TypeScript
implementation in practice.

PR #801 is the correctness baseline for this plan. It restores traversal-order
convergence, preserves typed-run origins, and makes event-ID ordering
transitive. The remaining work is deliberately split into independently
reviewable phases. Every phase must preserve the semantic gates established by
the phases before it.

Paper alignment means:

- the same valid event graph always converges regardless of delivery or
  topological traversal order;
- a two-branch merge performs `O((k + m) log(k + m))` structural work;
- replay CRDT state is temporary and excluded from portable persistence;
- the portable event graph uses the paper's compact columnar representation;
- deviations such as UTF-16 indexes, compound operations, resume snapshots,
  and a bounded replay cache are explicit compatibility or performance
  extensions.

## Status and Delivery Rules

- **Complete baseline:** PR #801 semantic fixes.
- **Current deliverable:** this plan only.
- **Implementation:** one pull request per phase below; do not combine phases
  merely because they touch the same subsystem.
- **Working tree safety:** do not absorb unrelated modified or untracked files
  when implementing any phase. Stage explicit paths only.
- **Compatibility:** existing single-event APIs, JSON serialization, UTF-16
  operations, and `NativeSnapshotCodec` remain supported.

## Phase 1: Semantic Oracle and Trustworthy Benchmarks

### Reference conformance runner

Add an external conformance command that consumes the author's pinned
TypeScript reference checkout without committing its 3.6 MB fixture.

- Pin repository commit
  `7287f4bc2c054984838b3582a27b4fea8f6d8161`.
- Require `testdata/conformance.json` SHA-256
  `95bdb544deca513441a50ea26a1c3ecbad116061c1d0fd6dde3175ea1e0bffd7`.
- Resolve the checkout from `EG_WALKER_REFERENCE_ROOT`, falling back to a
  documented local cache path. Never download during the ordinary unit-test
  suite.
- Shatter reference transactions into atomic scalar insert/delete events while
  preserving raw agent sequence IDs and local-version parents.
- Run both canonical `agent:sequence` IDs with typed-run coalescing enabled and
  non-canonical padded IDs with coalescing disabled.
- Fail unless all 1,000 cases and all 91,678 atomic events are processed and
  final text matches exactly.

Expose this as `pnpm --filter @softmaple/eg-walker test:conformance`. Ordinary
CI continues to use committed minimal regressions and property tests; release
and paper-performance jobs run the external corpus explicitly.

### Paper-trace conversion

Make operation-granularity conversion the only mode accepted by paper-aligned
benchmarks.

- Build a scalar reference replay that materializes the document at every
  transaction frontier, including multi-parent frontiers.
- Convert each scalar index to the corresponding UTF-16 boundary from that
  materialized parent document.
- Reject a trace if a parent frontier cannot be reconstructed, an index is not
  a scalar boundary, the operation count differs from its declared span, or
  final text differs from `endContent`.
- Keep patch-level conversion only as an explicitly named import stress test.
  Its output must never be reported as paper-conformant timing, memory, or
  storage data.

### Baseline report

For every paper dataset, record:

- source commit and fixture checksum;
- event and transaction counts;
- conversion, merge, load, and materialization time separately;
- full/partial/incremental replay counts;
- retreat, advance, integration-probe, and tree-operation counts;
- current and peak replay-record counts;
- process peak memory;
- JSON, portable columnar, and optional resume-snapshot bytes.

Absolute Rust/Yjs numbers from different hardware are context only. Trend
gates compare repeated runs on the same machine and runtime.

## Phase 2: Atomic Batch Remote Integration

### Public API

Add the following additive API:

```ts
interface ApplyRemoteEventsResult {
  readonly results: ReadonlyArray<ApplyRemoteEventResult>;
  readonly operations: ReadonlyArray<PositionOperation> | null;
}

applyRemoteEvents(
  events: ReadonlyArray<GraphEvent>,
): ApplyRemoteEventsResult;
```

`results` is aligned with input order. `operations` contains transformed
operations in actual application order only when that sequence is exact. It is
`null` when a full/partial replay, flushed descendants, or any other multi-event
effect prevents exact attribution. `applyRemoteEvent` delegates to a
single-element batch and preserves its existing return contract.

### Staged transaction

Process a batch as an all-or-nothing transaction:

1. Deep-clone events and parent sets.
2. Validate IDs, parent shapes, safe-integer indexes/lengths, UTF-16 payloads,
   duplicate-ID consistency, and already-known duplicates.
3. Stage graph additions, missing-parent queues, frontier changes, and causal
   order without mutating live state.
4. Apply every causally ready event against a staged replay/text state. Validate
   operation indexes against the event's parent prepare version.
5. Commit graph, document, frontier, pending queues, replay cache, checkpoints,
   and stats together.

If any ready event is invalid or replay throws, no observable or diagnostic
state may change. Missing-parent events are not errors: they are committed to
the pending queue only if the rest of the transaction succeeds. Pending chains
must drain through an iterative work queue, never recursion.

### Playground transport and sync

- Send `SerializedGraphEventOutput` with `parentVersion: string[]`; never JSON
  encode a `Set`.
- Exchange frontier and known event IDs in sync messages.
- Compute missing events through causal-set difference, not event count or
  array slicing.
- Feed received changes through `applyRemoteEvents` so a network batch causes
  one replay plan and one text remap.

## Phase 3: Replay Lifecycle and Persistent Text Buffer

### Persistent chunked rope

Replace repeated JavaScript string splices with an immutable, structurally
shared UTF-16 rope.

- Target leaf size: 2,048 UTF-16 code units.
- Split below/above bounds: 1,024 and 4,096 code units.
- Internal branch factor: 32.
- Required operations: `length`, `insert`, `delete`, `slice`, and `toString`.
- Edits copy only the root-to-leaf paths; checkpoint roots share unchanged
  nodes.
- `getText()` lazily flattens the current root and caches the result until the
  next edit.

Keep the rope independent of CRDT records. The document remains plain text;
the replay engine merely emits edits against it.

### Replay lifecycle

- When an event's parent frontier equals the current frontier, apply its
  original operation directly without constructing an engine.
- On divergence, evaluate criticality in the graph including the incoming
  batch, select the newest valid checkpoint before both sides, and replay only
  the divergent suffix with placeholders.
- Retain an in-memory replay cache to absorb streaming concurrent bursts. It is
  bounded by whichever limit is reached first: 4,096 events or an estimated
  32 MiB of replay state.
- The cache is never serialized or replicated. Eviction discards it and falls
  back to the newest valid critical checkpoint.
- Keep at most 32 critical checkpoint roots. They are cheap shared rope roots,
  not 32 materialized document strings.
- A full replay is reserved for cold start, corrupted/missing checkpoint data,
  or a late event older than every retained valid checkpoint.

Add the following diagnostic fields to replay stats:

- `replayCacheEvents`;
- `replayCacheBytes`;
- `textBufferNodeCount`;
- `checkpointUniqueTextBytes`.

These fields are additive and diagnostic; they do not enter serialized state.

## Phase 4: Logarithmic Fugue/YjsMod Integration

### Indexed integration order

Introduce an engine-private `FugueOrderIndex` and retain the current linear
scan as a slow reference oracle used only by tests.

- Maintain a deterministic order-statistic treap for the sibling regions of
  each `originLeft`.
- Compare right anchors through a stable order-maintenance label index, then
  use event ID as the final tie-break for identical origin tuples.
- Store subtree record spans so the end of the preceding sibling region maps
  directly to a global sequence insertion rank.
- Derive treap priority from a stable hash of the item ID; never use runtime
  randomness or arrival order.
- Update labels and subtree spans whenever the ranked sequence splits or a
  typed run is isolated.
- A typed-run split must update the ranked sequence, origin-left reverse index,
  Fugue index, event-item index, delete-target index, and order labels in one
  invariant-preserving operation.

The production insertion path must not call the linear conflict scan. Property
tests generate the same events for the indexed path and the slow oracle and
compare final order, transformed operations, and internal origin tuples.

### Structural complexity counters

Instrument, without timing assertions in ordinary CI:

- ranked B-tree node visits and splits;
- Fugue treap comparisons, rotations, and label relabels;
- rope node visits, splits, and joins;
- events applied, retreated, and advanced.

The counters must demonstrate logarithmic per-operation structural work on the
scaling fixtures below.

## Phase 5: Portable Persistence and Event-Model Boundary

### Compound-event compatibility

Keep the existing UTF-16/range public and wire model. Treat it as a compound
event extension rather than claiming it is the paper's scalar event model.

Add an internal `PaperEventAdapter` for conformance, benchmarks, and
differential tests. It represents expanded operations with structured
`{ sourceEventId, offset }` identities inside the adapter only; it must not
migrate or rewrite production event IDs. Compound operations and their scalar
expansion must produce equivalent visible text for every tested parent graph.

### Portable snapshot

Add a paper-aligned persistent snapshot alongside the existing resume snapshot:

```ts
interface PortableSnapshot {
  readonly formatVersion: "EGWP1";
  readonly text: string;
  readonly initialText: string;
  readonly currentVersion: ReadonlyArray<EventId>;
  readonly eventCount: number;
  readonly nextSequenceNumber: number;
  readonly metadata?: Record<string, unknown>;
  readonly eventGraph: SerializedGraphOutput;
}
```

Public additions:

- `PortableSnapshotCodec`;
- `EgWalkerReplica.createPortableSnapshot()`;
- `EgWalkerReplica.fromPortableSnapshot()`.

The `EGWP1` wire format contains a compact header followed by the existing
EGW3 columnar graph bytes. It must not contain sequence records, delete targets,
critical checkpoints, replay cache data, Fugue indexes, rope nodes, or any
other CRDT runtime state. Loading exposes text immediately, keeps graph decode
lazy, and starts with no replay engine.

`NativeSnapshotCodec` and EGWS1 remain supported as an explicitly optional
fast-resume extension. Its documentation must state that it persists runtime
state and is not the paper-aligned portable format.

### Event immutability and strict decode

- Clone events and parent sets when entering `EventGraph`.
- Return immutable copies from public graph exports.
- Reject malformed parent containers, non-string parents, duplicate IDs with
  conflicting payloads, cycles, and invalid serialized versions.
- Never silently coerce `{}` or malformed parent data to an empty version.

## Verification Matrix

### Semantic gates

- Pinned author corpus: 1,000/1,000 in canonical/coalesced mode and
  1,000/1,000 in padded/non-coalesced mode.
- Property tests: at least 1,000 runs for delivery-order invariance,
  multi-replica convergence, duplicates, missing parents, long branches,
  snapshot suffixes, and scalar/compound equivalence.
- Exhaustive small DAGs: every valid topological order produces identical text
  and record order.
- Explicit regressions: mixed IDs, typed-run splits, checkpoint eviction,
  concurrent double-delete, deleted right anchors, and multi-parent inserts.

### Transaction gates

For malformed UTF-16, fractional/NaN values, parent-view out-of-range indexes,
duplicate conflicts, and replay exceptions, compare before/after:

- text;
- serialized event graph;
- frontier;
- pending-event count and contents;
- replay statistics;
- checkpoint/cache statistics.

Every value must be unchanged after failure.

### Complexity gates

- Batch 1,600 mutually concurrent root inserts: at most one cold full replay.
- Stream 1,200 mutually concurrent root inserts within cache limits: at most
  two full replays and one checkpoint miss.
- For 400/800/1,600 event scaling, structural operation counts must follow
  `O(n log n)`; the production linear-scan counter must remain zero.
- For two offline branches of `k` and `m` events, every event is applied once,
  `retreat + advance <= 2 * (k + m)`, and indexed operations remain
  logarithmic.
- A same-machine release benchmark uses medians after warmup and requires each
  2x input increase to stay at or below a 2.75x time increase. This is a
  release report gate, not an ordinary CI timing assertion.

### Memory and persistence gates

- After 100,000 linear events, no replay engine is resident and
  `sequenceRecordCount` is zero.
- Replay cache never exceeds 4,096 events or 32 MiB.
- Checkpoint texts share rope nodes; unique retained text memory grows with
  changed chunks, not checkpoint count times document length.
- EGWP1 round-trip preserves text, metadata, frontier, event set, and next local
  sequence number.
- Decoded EGWP1 contains no runtime CRDT state and is smaller than the
  equivalent JSON graph on all maintained size fixtures.

### Unicode and sync gates

- Cover emoji, combining marks, ZWJ sequences, inserts/deletes on both sides of
  surrogate pairs, and multi-parent transaction frontiers.
- Compound operations and scalar reference expansion must remain equivalent.
- Two rooms with equal event counts but different event sets exchange their
  causal differences and converge.
- WebSocket JSON round-trips preserve every parent edge.

## Completion Criteria

The roadmap is complete only when all semantic, structural complexity, memory,
portable-persistence, Unicode, transaction, and sync gates pass together. A
performance improvement that weakens the conformance corpus or a storage
optimization that persists hidden runtime CRDT state does not satisfy this
plan.
