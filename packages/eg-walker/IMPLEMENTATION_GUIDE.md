# Eg-walker Implementation Guide

This package implements the architecture from "Collaborative Text Editing with
Eg-walker: Better, Faster, Smaller" as a small set of focused modules. The
legacy scaffolded `crdt/` implementation has been removed.

## Package Layout

```text
src/
  core/
    external-api.ts   Public index-based API
    walker.ts         Thin graph replay coordinator
    invariants.ts     Strong-list helpers used by tests and callers
  engine/
    eg-walker-engine.ts  Prepare/effect replay algorithm
    indexed-sequence.ts  Ranked B-tree index mapping
    critical-version.ts  Critical checkpoint detection
    partial-replay.ts    Replay from checkpoint text/version
  graph/
    event-graph.ts       Persistent DAG, frontiers, causal diff
    columnar-codec.ts    Columnar event graph encode/decode
  types/
    index.ts          Public package types
```

## Paper Mapping

| Paper section               | Implementation                                                             |
| --------------------------- | -------------------------------------------------------------------------- |
| 3.1 Characteristics         | `core/external-api.ts`, `core/invariants.ts`, `engine/eg-walker-engine.ts` |
| 3.2 Walking the event graph | `core/walker.ts`, `graph/event-graph.ts`, `engine/eg-walker-engine.ts`     |
| 3.3 Prepare/effect versions | `engine/eg-walker-engine.ts`                                               |
| 3.4 Index mapping           | `engine/indexed-sequence.ts`                                               |
| 3.5 Critical versions       | `engine/critical-version.ts`                                               |
| 3.6 Partial replay          | `engine/partial-replay.ts`                                                 |
| 3.8 Event graph storage     | `graph/columnar-codec.ts`                                                  |

## Runtime Model

Persistent state:

- Plain document text.
- Immutable event graph.

Temporary state:

- Augmented replay items in `EgWalkerEngine`.
- Prepare state as numeric states: `0`, `1`, `2+`.
- Effect state via `everDeleted`.
- Ranked B-tree leaves with prepare/effect/count aggregates for index mapping.

The temporary replay state is not exported, serialized, or retained by
`EgWalkerReplica`.

## Section 3.4 Internal-Document Fast Path

`EgWalkerEngine.processEvent` short-circuits the diff/retreat/advance
machinery when an event's `parentVersion` matches the engine's current
version as a set. In that case the prepare-state of the sequence already
matches the event's parent view, so the operation reduces to a linear edit
on top of the current state. The fast path is taken on:

- Single-author traces (every event's parent is the previous event).
- Remote events that extend the shared frontier without divergence.
- The non-divergent tail of an otherwise concurrent history.

For inserts, `applyInsert` additionally skips the YATA integration scan
when the destination range strictly between `originLeft` and `originRight`
is empty (the dominant case under a non-conflicting run), and batches
multi-character inserts at sequential positions because every code unit
after the first is chained off a brand-new id that no existing item can
reference. Concurrent or divergent events still fall back to the full
prepare/effect replay path; both paths produce identical output.

Stats exposed on `GeneratedDocument.stats.nonConflictingRunCount` and
`fullReplayCount` (also surfaced through `ReplayWalker.walk`) let callers
and tests verify which path was taken.

## Storage Model

The binary columnar codec stores topologically sorted graph data in separate
columns for operation runs, operation indexes, lengths, text lengths, parent
overrides, event ID runs, and timestamps. Integer columns use unsigned varints;
inserted UTF-8 content is compressed with LZ4 framed compression.

## Verification

The test suite is architecture-focused:

- `eg-walker-engine.test.ts`: replay, deletes, critical checkpoints, partial replay, columnar codec.
- `event-graph.test.ts`: DAG, frontier, causal expansion/diff, serialization.
- `external-api.test.ts`: public API and persistence round-trip.
- `algorithm-characteristics.test.ts`: convergence, non-interleaving, no persistent CRDT metadata.
- `invariants.test.ts`: strong-list helper behavior.
- `non-conflicting-run-perf.test.ts`: Section 3.4 fast-path activation, fallback correctness, and a 20k-event linear-trace benchmark.
