# Native Snapshot Plan for @softmaple/eg-walker

## Goal

Make `@softmaple/eg-walker` load persisted documents from a native snapshot
without replaying the full event graph, while keeping the implementation in
TypeScript.

The current columnar payload is useful, but it persists event history rather
than runtime state. `new EgWalkerReplica(..., decodedGraph)` still reconstructs
the document by running `fullReplay`, so native load remains seconds-level on
paper-scale traces. The target is to make native load mostly:

1. decode bytes;
2. restore compact runtime indexes;
3. expose `getText()` and continue editing.

This plan intentionally does not target Rust/WASM-level performance. The
realistic target is 100-500ms native load for paper-scale traces in pure
TypeScript, with a stretch target below 100ms on simpler datasets.

## Non-Goals

- Do not replace the public API.
- Do not expose CRDT IDs or internal metadata through public editor APIs.
- Do not rewrite the whole engine in Rust or WASM.
- Do not make raw paper JSON ingest comparable to Yjs native update loading.
- Do not require loading old snapshots without a migration path.

## Current Bottleneck

The current native path stores enough data to rebuild an `EventGraph`, but not
enough data to restore an already-materialized replica. That means load still
pays for:

- validating every `GraphEvent`;
- reconstructing `Map`/`Set` graph structures;
- rebuilding topological order;
- replaying all operations through `EgWalkerEngine.generate`;
- rebuilding `IndexedSequence`, `itemsById`, `eventItems`, `originLeftIndex`,
  and `deleteTargets`;
- repeatedly materializing JS strings during replay.

The decoded binary graph is not the main problem. The replay and object
materialization are.

## Target Snapshot Contents

A native snapshot should persist two classes of state.

### 1. Public Persistent State

This state must be enough to answer user-visible questions immediately after
load:

- final document text;
- current frontier;
- event count;
- next local sequence number;
- replica metadata currently written through `writeReplicaMetadata`.

### 2. Runtime Resume State

This state should let the replica continue applying local and remote edits
without full replay:

- compact event table;
- parent frontier table;
- children adjacency or enough data to rebuild it cheaply;
- insertion rank / topological rank;
- indexed sequence records;
- event-id to sequence-record references;
- origin-left index;
- delete target index;
- retained critical checkpoints;
- current engine version;
- optional cached branch-preserving/topological order metadata.

The key design rule: snapshot load may rebuild lightweight indexes from compact
arrays, but it must not apply historical edits through the engine.

## Format Direction

Use a versioned binary format, e.g. `EGWS1`.

Prefer struct-of-arrays over arrays of JS objects:

- event ids as numeric ids plus string table;
- operation type as `Uint8Array`;
- operation index/length as `Uint32Array`;
- timestamps as `Float64Array` or omitted from hot runtime state if not needed;
- parent ranges as CSR-like offsets plus flat parent id array;
- text payloads as UTF-8 string table or contiguous text blob with offsets;
- sequence records as parallel arrays.

Avoid persisting `Map`, `Set`, or object-shaped events as the primary native
format. Those can be lazily reconstructed only when a public/debug API asks for
them.

## Proposed Snapshot Model

### Event Table

Persist:

- `eventIdTable`: string table or numeric canonical id encoding;
- `parentOffset`: `Uint32Array`, length `eventCount + 1`;
- `parentIds`: `Uint32Array`;
- `operationType`: `Uint8Array`;
- `operationIndex`: `Uint32Array`;
- `operationLengthOrTextId`: `Uint32Array`;
- `timestamp`: optional `Float64Array`;
- `insertionRank`: implicit by array position.

For paper traces and generated local events, event ids should be normalized to
numeric ids early. Keep a string table for external compatibility, but make the
hot runtime operate on numbers.

### Sequence Records

Persist the `IndexedSequence` leaf records directly:

- record id;
- event numeric id;
- content offset/length;
- originLeft record id or sentinel;
- originRight record id or sentinel;
- `everDeleted`;
- `prepareState`;
- typed-run metadata: replica id, start sequence, length;
- prepare/effect weights.

The snapshot should restore the ranked sequence tree either:

1. exactly, by storing leaf and internal-node layout; or
2. cheaply, by storing leaf records in order and bulk-building a balanced tree.

Option 2 is simpler and should be fast enough initially.

### Secondary Indexes

Persist or rebuild from sequence records:

- `itemsById`;
- `eventItems`;
- `originLeftIndex`;
- `deleteTargets`.

Initial implementation can rebuild these from compact arrays during snapshot
load. If this becomes a bottleneck, add serialized index sections.

### Checkpoints

Persist retained critical checkpoints:

- checkpoint frontier;
- checkpoint text or text reference;
- checkpoint rank/version metadata used by `CriticalCheckpointStore`.

If checkpoint text is too large, persist only checkpoints that materially reduce
future replay and cap total checkpoint bytes.

## API Shape

Add explicit snapshot APIs rather than overloading existing graph serialization.

```ts
class EgWalkerReplica {
  createNativeSnapshot(): NativeSnapshot;
  static fromNativeSnapshot(
    snapshot: NativeSnapshot,
    replicaId?: string,
  ): EgWalkerReplica;
}

class NativeSnapshotCodec {
  encode(snapshot: NativeSnapshot): Uint8Array;
  decode(bytes: Uint8Array): NativeSnapshot;
}
```

Keep the existing `serialize()` / `deserialize()` compatibility path for JSON
event-graph snapshots.

## Implementation Phases

### Phase 0: Measurement Guardrails

Add benchmarks before changing format:

- S1/S2/S3 native snapshot load;
- A1 native snapshot load;
- C1/C2 bounded 3k and 10k snapshot load;
- snapshot encode time;
- snapshot byte size;
- memory delta with `node --expose-gc`.

Add result fields:

- `snapshotEncodeMs`;
- `snapshotDecodeMs`;
- `snapshotRestoreMs`;
- `snapshotBytes`;
- `snapshotHeapBytes`.

Success criteria:

- current graph-native path remains as baseline;
- new benchmarks distinguish decode time from restore time.

### Phase 1: Persist Final Text and Fast Read-Only Load

Create a minimal snapshot containing:

- final text;
- event table;
- frontier;
- next sequence number;
- metadata.

Load should return a replica that can answer `getText()` immediately but may
fall back to event-graph replay before the first edit.

This phase proves format plumbing and gives a fast read-only load path.

Success criteria:

- `getText()` after load is O(text bytes), not O(history);
- snapshot round-trips S1/S2/S3/A1;
- existing JSON serialization tests still pass.

### Phase 2: Restore EventGraph Without GraphEvent Object Explosion

Introduce an internal compact graph representation:

- numeric event ids;
- parent CSR arrays;
- frontier array;
- lazy `GraphEvent` materialization for compatibility APIs.

Either adapt `EventGraph` to support compact backing storage, or add a
`CompactEventGraph` that implements the subset needed by the engine.

Success criteria:

- loading a snapshot does not allocate one JS object plus one `Set` per event;
- `diffVersions` works on numeric arrays;
- existing graph property tests pass against both object and compact graph
  backends.

### Phase 3: Bulk-Restore IndexedSequence

Add a bulk constructor for `IndexedSequence`:

```ts
IndexedSequence.fromRecords(records, prepareWeight, effectWeight);
```

It should build leaves and internal nodes in linear time instead of repeated
`insert`.

Current status: the regular `IndexedSequence` constructor now bulk-builds
initial items in leaf chunks and balanced internal levels instead of inserting
each item one at a time. Native snapshots now persist sequence records and
wire the bulk path into engine adoption.

Restore sequence records from snapshot:

- no edit replay;
- no per-character insertion loop;
- no JS string splice.

Success criteria:

- S1/S2/S3 snapshot restore is dominated by decoding and tree construction;
- restore time is below 500ms for S1/S2/S3 on local Node v24;
- `getText()` matches the saved final text;
- a local insert after load works.

Status: implemented for correctness. Full-paper restore is still above the
initial timing target because sequence records are currently decoded as
object-shaped JSON/header data before engine adoption.

### Phase 4: Restore Engine Resume State

Allow `EgWalkerReplica` to adopt an already-restored engine state:

- current version;
- resulting text;
- indexed sequence;
- event item indexes;
- delete target indexes;
- origin-left index;
- pending insert buffer empty;
- replay stats initialized.

This avoids full replay on the first post-load edit.

Success criteria:

- local insert/delete after snapshot load does not trigger full replay;
- remote event extending frontier takes incremental path;
- bounded concurrent remote event can use checkpoint/partial replay path;
- replay stats prove `fullReplays === 0` for snapshot load.

Status: complete. Snapshot restore adopts engine state directly from persisted
sequence records, delete targets, and origin/index data rebuilt from the
records. Regression tests cover local edits, frontier-extending remote edits,
and bounded concurrent remote edits without snapshot-load full replay.

### Phase 5: Persist Checkpoints

Serialize retained critical checkpoints and restore them on load.

Success criteria:

- C1/C2 bounded divergent events after load still hit checkpoints;
- checkpoint count and hit/miss behavior match pre-snapshot behavior within
  expected tolerance;
- no large unbounded checkpoint text growth.

Status: complete for retained critical checkpoints. Native snapshots persist
checkpoint `version`, `text`, and `eventCount`, restore them into
`CriticalCheckpointStore`, and cap retention through the existing store limit.
Regression tests cover restoring an older retained checkpoint and using it for
partial replay after snapshot load.

### Phase 6: Optimize Snapshot Size

After correctness and load speed are in place:

- varint encode numeric ids and offsets;
- dictionary-code operation types and replica ids;
- delta-code monotonic ids and indexes where applicable;
- store text payloads as UTF-8 blobs with offset tables;
- optionally compress cold sections.

Success criteria:

- snapshot size is competitive with current columnar graph payload;
- size optimization does not reintroduce slow decode/restore.

Phase 6 is complete. Phase 4/5 removed full replay during snapshot restore,
and Phase 6 moved the remaining runtime state to compact binary sections,
compressed cold sections, removed hot decode copies, and codified tightened
benchmark gates.

On 2026-06-05, before Phase 6, S3 snapshot restore averaged about 4.0s with a
346MB snapshot and about 1.43GB heap delta in memory mode. After PR #788 on
2026-06-08, the same S3 full patch smoke was about 1.8-1.9s restore with a
67.1MB snapshot and about 789MB snapshot heap delta. After completing the
remaining old Phase 6 split items later on 2026-06-08, the full
`--phase6-gates --memory` suite reported S3 snapshot decode at 1.51s, restore
at 195ms, snapshot size at 62.4MB, and restore heap delta at about 135MB. The
wire format and cold-section compression work are effective; the remaining
bottleneck is decode/materialization, especially object allocation in the large
S3 snapshot. The final Phase 6 pass on 2026-06-09 removed avoidable
`Uint8Array` section copies, decoded zigzag-delta runtime columns directly into
typed arrays, deferred restored event indexes until divergent edits need them,
and tightened `--phase6-gates` budgets. The tightened full
`--phase6-gates --memory` run passed with S3 snapshot decode at 788ms, restore
at 191ms, snapshot size at 62.4MB, snapshot decode heap at 89MB, restore heap
at 135MB, and `snapshotFullReplays=0`.

Recommended breakdown:

1. Move `sequenceRecords` out of the JSON header into a binary section.
   Status: complete in the first Phase 6 PR. Runtime sequence records and
   delete-target records now live in a binary runtime-state section after the
   JSON header and columnar graph payload. The public `NativeSnapshot` shape and
   legacy length-prefixed snapshots that still carry runtime records in JSON
   remain supported.
2. Decode sequence records into compact arrays rather than
   `EngineSequenceRecord[]` objects.
   Status: complete in PR #788. Decoded snapshots cache compact runtime state;
   public `sequenceRecords` and `deleteTargets` remain lazy compatibility
   getters.
3. Dictionary-code event ids, origin ids, and run replica ids.
   Status: complete for the runtime-state wire format in PR #788. The binary
   section uses id and replica string tables, optional-id sentinels, and a UTF-8
   content blob with offset tables. Fast restore consumes compact runtime state
   directly instead of first materializing `EngineSequenceRecord[]`.
4. Add varint/delta encoding for numeric offsets, indexes, and ids.
   Status: complete for runtime-state columns in PR #788. `EGWR2` runtime state
   delta-codes id/origin/run numeric columns, content offsets, and flat
   delete-target refs/offsets. Legacy unversioned runtime-state blobs remain
   readable, including blobs whose first bytes collide with `EGWR2`.
5. Optionally compress cold sections after the hot restore path no longer
   materializes large object arrays.
   Status: complete for cold native snapshot sections. `EGWC1` wraps large
   header and graph sections only when LZ4 makes the section smaller, and the
   decoder still accepts unwrapped legacy sections. Runtime state remains on the
   hot uncompressed `EGWR2` path.

Expected size: 3-5 focused PRs. A useful first milestone is to reduce S1/S2/A1
snapshot restore below 500ms and S3 below 1.5s without regressing
`snapshotFullReplays === 0`.

First milestone status: mostly implemented for the runtime-state wire format.
The snapshot codec writes a small JSON header, the EGW3 columnar graph payload,
and a versioned `EGWR2` runtime-state section. Large cold header/graph sections
may now be wrapped in `EGWC1` compressed bytes; graph section decompression is
lazy with graph materialization. `writeMappedVarintArray` and
`writeMappedZigZagDeltaArray` stream mapped columns directly to the binary
writer, avoiding encode-time intermediate arrays for sequence-record columns.
`DeleteTargetRecord` data is stored as flat refs plus offsets instead of nested
per-delete arrays.

The first milestone restore targets are now met by the 2026-06-08
`--phase6-gates --memory` run: S1/S2/A1 restore in about 100-120ms and S3
restores in about 195ms. The remaining issue is no longer restore replay; it is
S3 decode/materialization. S3 still spends about 1.5s in snapshot byte decode
and allocates the largest decode/restore heap deltas in the gate suite.

Final Phase 6 status: complete as of the 2026-06-09 tightened
`--phase6-gates --memory` run. Full-trace S1/S2/S3/A1 restore remains under
200ms in the main benchmark process, S3 decode is now below 0.8s in the final
gate run, bounded C1/C2 restore is sub-10ms, and A2 300-txn operation restore
is about 12ms.

## Risks

### Snapshot Correctness Risk

Restoring runtime state bypasses replay, so bugs may create a replica that looks
correct until the first concurrent edit. Mitigate with property tests:

- snapshot after random trace;
- load snapshot;
- apply random local/remote suffix;
- compare with a replica that replayed the full history.

Status: implemented in `native-snapshot-suffix.property.test.ts`. That test
also caught a frontier/runtime-state mismatch for non-empty initial text; native
snapshots now rebuild snapshot runtime state when the live engine's current
version does not match the persisted graph frontier.

### Format Lock-In

Avoid exposing low-level snapshot sections publicly. Keep a versioned codec and
migration layer.

### Memory Regression

Persisting more state can improve load time but increase memory. Track both
snapshot bytes and live heap.

### Compatibility With Existing Event IDs

Numeric ids are required for speed, but public/debug APIs may expect string ids.
Use an id table and lazy materialization.

## Test Plan

Add tests in layers:

1. deterministic unit tests for encoding/decoding each section;
2. round-trip tests for small hand-written graphs;
3. property tests comparing snapshot-load vs replay-load after random suffixes;
4. paper trace smoke tests for S1/S2/S3 and A1;
5. bounded C1/C2 and A2 operation-level smoke tests;
6. memory tests gated behind an explicit benchmark command.

## Benchmark Targets

Initial target:

- S1/S2/S3 snapshot load under 500ms each;
- A1 snapshot load under 250ms;
- C1/C2 bounded 10k snapshot load under 250ms;
- no full replay during snapshot load.

Stretch target:

- S1/S2 under 100ms;
- S3 under 200ms;
- A1 under 100ms;
- snapshot memory within 2-5x Yjs for equivalent datasets.

Do not claim algorithmic superiority over Yjs unless using comparable native
load formats and full datasets.

## Current Recommended Next PR

Phase 6 has no remaining required work. Recommended follow-ups are post-Phase 6
runtime profiling:

1. Profile full `C1`/`C2` patch-level runs as a long-run workload before adding
   them to routine gates.
2. Profile the optimized `C1`/`C2` path before the next runtime change; current
   hot spots are spread across insert handling, indexed sequence updates, and
   `diffVersions`.
3. Decide whether `A2` should support a faster faithful mode than full
   operation-level conversion. The current operation-level path is correct for
   bounded samples but grows too quickly past the 300-txn smoke test.

## Historical Recommended First PR

Start with Phase 0 and Phase 1 only:

1. Add `NativeSnapshot` types.
2. Add `NativeSnapshotCodec` with a simple versioned binary or JSON-backed
   prototype.
3. Persist final text, metadata, event table summary, and frontier.
4. Add `fromNativeSnapshotReadOnly` or equivalent internal constructor.
5. Add paper benchmark fields for snapshot encode/decode/read-only load.

This gives immediate measurements without risking replay correctness. After
that, proceed to compact graph and sequence restore.
