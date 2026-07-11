# Eg-walker Implementation Guide

This package implements the architecture from "Collaborative Text Editing with
Eg-walker: Better, Faster, Smaller" as a small set of focused modules. The
legacy scaffolded `crdt/` implementation has been removed.

## Package Layout

```text
src/
  core/
    replica.ts            Public index-based API (EgWalkerReplica)
    replay-walker.ts      Thin graph replay coordinator
    invariants.ts         Strong-list helpers used by tests and callers
  engine/
    eg-walker-engine.ts   Prepare/effect replay orchestrator
    indexed-sequence.ts   Ranked B-tree index mapping
    critical-version.ts   Critical checkpoint detection
    partial-replay.ts     Replay from checkpoint text/version
    internals/            Engine-private helpers (no semver)
      engine-types.ts        AugmentedCRDTItem, TypedRun, placeholder constants, result types
      text-utils.ts          spliceText, deleteText, stringCodeUnits, coalesceDeleteRuns
      pending-insert-buffer.ts  Typed-run coalescing buffer for the Section 3.4 fast path
      origin-left-index.ts   Reverse index: target id -> items anchored as originLeft
      delete-target-index.ts Bidirectional index of delete events and the items they targeted
      yata-integration.ts    findIntegrationPosition (YATA scan)
      record-splitter.ts     Split-on-demand for placeholder and typed-run records
  graph/
    event-graph.ts        Persistent DAG, frontiers, causal diff
    columnar-codec.ts     Columnar event graph encode/decode
  types/
    index.ts              Public package types
```

## Paper Mapping

| Paper section               | Implementation                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 3.1 Characteristics         | `core/replica.ts`, `core/invariants.ts`, `engine/eg-walker-engine.ts`                                            |
| 3.2 Walking the event graph | `core/replay-walker.ts`, `graph/event-graph.ts`, `engine/eg-walker-engine.ts`                                    |
| 3.3 Prepare/effect versions | `engine/eg-walker-engine.ts`, `engine/internals/yata-integration.ts`                                             |
| 3.4 Index mapping           | `engine/indexed-sequence.ts`, `engine/internals/record-splitter.ts`, `engine/internals/pending-insert-buffer.ts` |
| 3.5 Critical versions       | `engine/critical-version.ts`                                                                                     |
| 3.6 Partial replay          | `engine/partial-replay.ts`                                                                                       |
| 3.8 Event graph storage     | `graph/columnar-codec.ts`                                                                                        |

## Runtime Model

Portable persistent state (`serialize()`):

- Plain document text.
- Immutable event graph.

Replay working state:

- Augmented replay items in `EgWalkerEngine`.
- Prepare state as numeric states: `0`, `1`, `2+`.
- Effect state via `everDeleted`.
- Ranked B-tree leaves with prepare/effect/count aggregates for index mapping.

`EgWalkerReplica` currently retains this working state between edits to make
the linear/incremental path cheap. It is excluded from portable `serialize()`,
but the optional native-snapshot format stores sequence records, delete-target
records, and retained checkpoint texts as an implementation-specific fast-load
cache. This is an intentional engineering extension; it is not the paper's
strict "discard CRDT state at a critical version" storage architecture.

The implementation also uses UTF-16 code-unit indexes and allows one graph
event to carry a multi-code-unit insert or range delete. The paper's semantic
model uses one Unicode scalar insert/delete per event. These representations
agree for atomic BMP traces, while adapters for paper datasets must convert
both index units and event granularity explicitly.

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
columns for operation runs, operation indexes, operation lengths, parent
overrides, event ID runs, and timestamps. Inserted UTF-8 content is compressed
with LZ4 framed compression. The wire format (`EGW3`) drops every column that
is derivable from the others and switches the near-monotonic per-event columns
to zigzag-delta varints:

- `operationRuns` carry only `(type, length)` on the wire. `startEventOffset`
  is the prefix sum of run lengths; `startIndex` is
  `operationIndexes[startEventOffset]`; an INSERT run's `textLength` is the
  sum of `operationLengths` over the run's events.
- `operationIndexes` and `timestamps` are zigzag-delta varint arrays. Linear
  single-author traces and near-monotonic editor timestamps collapse to ~1
  byte per event regardless of document size.
- `operationLengths` is a plain varint array (typically one byte per event
  for single-character edits).
- `textLengths` is omitted entirely — `textLength[i]` equals
  `operationLengths[i]` when the covering run is INSERT, else `0`.
- `parentOverrides` event offsets are monotonic-delta varints (the first
  delta is relative to `-1`).
- `idRuns` drop `startEventOffset` (also the prefix sum of run lengths) and
  pack the `custom` flag into the low bit of the run length.

`packages/eg-walker/src/test/columnar-codec-size.test.ts` benchmarks the binary
form against `JSON.stringify(graph.serialize())` over four realistic editing
traces (linear append, mixed insert/delete, paste-then-edit, multi-author
concurrent merges) and asserts hard size-ratio upper bounds as a regression
guard. `EGW2` and `EGW1` payloads are rejected at decode.

## Verification

The test suite is architecture-focused:

- `eg-walker-engine.test.ts`: replay, deletes, critical checkpoints, partial replay, columnar codec.
- `event-graph.test.ts`: DAG, frontier, causal expansion/diff, serialization.
- `replica.test.ts`: public API and persistence round-trip.
- `algorithm-characteristics.test.ts`: convergence, non-interleaving, no persistent CRDT metadata.
- `invariants.test.ts`: strong-list helper behavior.
- `non-conflicting-run-perf.test.ts`: Section 3.4 fast-path activation, fallback correctness, and a 20k-event linear-trace benchmark.
- `pending-insert-buffer.test.ts`, `origin-left-index.test.ts`, `delete-target-index.test.ts`: focused unit tests for the `engine/internals/` helpers.
