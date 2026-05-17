# Claude AI Guidelines for eg-walker Package

`@softmaple/eg-walker` implements the Eg-walker paper architecture directly.
There is no legacy `crdt/` runtime layer.

## Layering Rules (Source of Truth)

The cross-package boundaries for `@softmaple/eg-walker`,
`@softmaple/awareness`, and `apps/*` are defined in
[`docs/design/collaboration-layers.md`](../../docs/design/collaboration-layers.md).
That document is the source of truth and is enforced mechanically by
the `egWalkerCollaborationConfig` export from
`@softmaple/eslint-config/collaboration-layers`.

In short, this package MUST NOT depend on `@softmaple/awareness`, on
any editor framework (`lexical`, `prosemirror-*`, `slate*`), or expose
anything other than index-based operations on its public API. Read the
layering doc before adding or moving public exports.

## Current Structure

```text
src/
  constants/operation-types.ts
  core/
    replica.ts
    invariants.ts
    replay-walker.ts
    internals/
      critical-checkpoint-store.ts
      persistence-metadata.ts
      remote-event-buffer.ts
  engine/
    eg-walker-engine.ts
    indexed-sequence.ts
    critical-version.ts
    partial-replay.ts
    internals/
      engine-types.ts
      text-utils.ts
      pending-insert-buffer.ts
      origin-left-index.ts
      delete-target-index.ts
      yata-integration.ts
      record-splitter.ts
      indexed-sequence-node.ts
      insert-handler.ts
      delete-handler.ts
  graph/
    event-graph.ts
    event-graph-errors.ts
    event-id.ts
    columnar-codec.ts
    internals/
      binary-io.ts
      diff-versions.ts
      event-graph-serialization.ts
      max-heap.ts
      topological-order.ts
  bench/
    traces.ts
    long-linear-history.bench.ts
    concurrent-same-index-inserts.bench.ts
    long-offline-branch-merge.bench.ts
    delete-heavy-workload.bench.ts
    checkpoint-effectiveness.bench.ts
  types/index.ts
```

## Working Rules

- Keep public operations index-based.
- Do not persist or export temporary replay metadata.
- Put causal graph logic in `graph/`.
- Put prepare/effect replay logic in `engine/`.
- Put layer-private helpers (no semver) under `<layer>/internals/`:
  `core/internals/` for replica-private state stores, `engine/internals/`
  for prepare/effect helpers, `graph/internals/` for codec/traversal
  helpers.
- Keep `core/` thin and user-facing.
- Avoid adding compatibility modules for removed legacy files.

## Verification

Run these before handing off changes:

```bash
pnpm --filter @softmaple/eg-walker test -- --run
pnpm --filter @softmaple/eg-walker typecheck
pnpm --filter @softmaple/eg-walker build
pnpm --filter @softmaple/eg-walker lint
```

## Benchmarks

`src/bench/*.bench.ts` are `vitest bench` files; trace builders live in
`src/bench/traces.ts` and are reused across scenarios. Run with:

```bash
pnpm --filter @softmaple/eg-walker bench
# or, with caching disabled:
turbo run bench --filter=@softmaple/eg-walker
```

Each scenario builds its trace once at module load, then the `bench()`
body applies events to a fresh `EgWalkerReplica` per iteration so the
measurement reflects end-to-end throughput from cold start. An
`afterAll` hook prints one stats line per scenario via `console.info`
using `summariseReplica` / `formatStatsLine` from `traces.ts`. The
fields come from `EgWalkerReplica.getReplayStats()` and the engine's
`getStats()`, so a regression in `fullReplays`, `partialReplays`,
`engineRetreats`, or `sequenceRecordCount` is visible alongside the
wall-clock numbers.

`getReplayStats()` surfaces both steady-state counters and a few
diagnostic fields aimed at benches:

- `fullReplays` / `partialReplays` / `incrementalApplies` — counts of
  which replay path handled each event.
- `engineRetreats` / `engineAdvances` — cumulative engine churn.
- `checkpointCount` — retained critical-version checkpoints in
  `CriticalCheckpointStore` (capped at 32 via LRU).
- `sequenceRecordCount` — live records in the ranked B-tree; a memory
  proxy.
- `peakSequenceRecordCount` — high-water mark of `sequenceRecordCount`
  across the **replica's** lifetime. The replica folds the outgoing
  engine's peak into a monotonic counter before each partial/full
  replay engine swap, so the value survives later
  deletes/coalescing *and* engine rebuilds: a transient spike during a
  concurrent merge stays visible even if the next event triggers a
  partial replay that creates a fresh engine.
- `criticalCheckpointHits` / `criticalCheckpointMisses` — how often
  `CriticalCheckpointStore.pickFor` produced a usable starting point
  vs. forced a full replay. A miss means no retained critical version
  dominated the divergent suffix.
- `lastReplaySource` — `"incremental" | "partial" | "full" | null`
  (const object `REPLAY_SOURCE` in `constants/replay-source.ts`),
  indicating which path handled the most recent event. `null` only on
  a replica that has not yet processed an event.

The `checkpoint-effectiveness` bench asserts
`criticalCheckpointHits > 0` in its `afterAll`, so a regression that
quietly stops using the checkpoint store fails the bench instead of
just changing the wall-clock number.

Scenarios:

- `long-linear-history` — single-author append-only chain; exercises
  the Section 3.4 non-conflicting-run fast path.
- `concurrent-same-index-inserts` — every event is concurrent with no
  shared parent; stresses YATA origin-left tie-breaking
  (`engine/internals/yata-integration.ts`).
- `long-offline-branch-merge` — two long branches fan in at a single
  merge event; measures recovery from a stale branch plus the
  retreat/advance work over a long offline edit.
- `delete-heavy-workload` — ~70% deletes; stresses
  `engine/internals/delete-target-index.ts`.
- `checkpoint-effectiveness` — paired benches comparing
  `applyRemoteEvent` (checkpoint-aware incremental) vs a single
  cold-start `fullReplay` via `EventGraph.fromEvents`. The vitest
  summary reports the speedup ratio between the two.

Bench files are excluded from coverage (`src/bench/**` and
`src/**/*.bench.ts` are added to `vitest.config.ts#coverage.exclude`).
