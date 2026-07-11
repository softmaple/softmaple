# @softmaple/eg-walker

Eg-walker implementation for collaborative plain-text editing, based on
["Collaborative Text Editing with Eg-walker: Better, Faster, Smaller"](https://arxiv.org/abs/2409.14252).

## Architecture

The package is organized around the paper's prepare/effect model:

- `graph/`: persistent event graph, frontier versions, causal expansion/diff, columnar codec.
- `engine/`: prepare/effect replay state, ranked B-tree index mapping, critical checkpoints, partial replay.
- `core/`: public API and thin walker coordinator.
- `types/`: public TypeScript types.

The portable `serialize()` format contains plain text plus the event graph and
does not persist CRDT replay records. `EgWalkerReplica` does cache an engine
between edits, and the optional native-snapshot API can persist that cache for
faster restore; those are implementation extensions rather than the paper's
minimal persistent-state model.

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

## Main APIs

Stable surface (`@softmaple/eg-walker`):

- `EgWalkerReplica` / `createEgWalkerReplica`: public index-based editing API.
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

Benchmarks live in `src/bench/` and are separate from the unit-test suite.
Run them manually — they never fail CI on timing:

```bash
pnpm --filter @softmaple/eg-walker bench
```

| Scenario                                            | File                                     | What it stresses                              |
| --------------------------------------------------- | ---------------------------------------- | --------------------------------------------- |
| Long linear history (5k sequential inserts)         | `long-linear-history.bench.ts`           | Section 3.4 non-conflicting-run fast path     |
| Concurrent same-index inserts (200 events)          | `concurrent-same-index-inserts.bench.ts` | YATA origin-left tie-breaking                 |
| Long offline branch merge (2×1k events)             | `long-offline-branch-merge.bench.ts`     | Retreat/advance over a stale branch           |
| Delete-heavy workload (2k events, ~70% deletes)     | `delete-heavy-workload.bench.ts`         | Delete-target-index and placeholder filtering |
| Checkpoint effectiveness (100 linear + 20 siblings) | `checkpoint-effectiveness.bench.ts`      | `CriticalCheckpointStore` partial-replay path |

Each scenario prints one stats line after the benchmark run, for example:

```
[bench:long-linear-history] events=5000 text=5000 fullReplays=1 partialReplays=0
  incrementalApplies=4999 retreats=0 advances=0 checkpoints=32
  sequenceRecords=1 peakSequenceRecords=1
  checkpointHits=0 checkpointMisses=0 lastReplaySource=incremental
```

#### Interpreting replay stats

| Field                   | Meaning                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `fullReplays`           | Cold-start or recovery replays over the full event graph. Should be 1 for linear workloads.                                           |
| `partialReplays`        | Replays scoped to the divergent suffix using a `CriticalCheckpointStore` anchor. Replaces full replays for concurrent-sibling merges. |
| `incrementalApplies`    | Events applied by advancing the existing engine state with no retreat. The dominant path for sequential editing.                      |
| `retreats` / `advances` | Cumulative engine moves. Non-zero for concurrent merges; proportional to the size of the divergent suffix, not the full history.      |
| `checkpoints`           | Retained critical-version checkpoints (capped at 32 via LRU). Higher means more reuse opportunities for future merges.                |
| `checkpointHits`        | Times `CriticalCheckpointStore.pickFor` found a usable anchor — avoids a full replay.                                                 |
| `checkpointMisses`      | Times no retained checkpoint dominated the divergent suffix — forced a full replay.                                                   |
| `sequenceRecords`       | Live records in the ranked B-tree at the end of the scenario. Memory proxy.                                                           |
| `peakSequenceRecords`   | High-water mark across the replica lifetime; stays visible even after deletes or engine rebuilds.                                     |
| `lastReplaySource`      | `incremental`, `partial`, or `full` — which path handled the last event.                                                              |

A healthy concurrent-merge workload shows `partialReplays > 0` and `checkpointHits > 0`, meaning the checkpoint store is being consulted and is avoiding full replays.

## References

- [Research paper](https://arxiv.org/abs/2409.14252)
- [Implementation guide](./IMPLEMENTATION_GUIDE.md)
