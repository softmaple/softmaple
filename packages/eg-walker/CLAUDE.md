# Claude AI Guidelines for eg-walker Package

`@softmaple/eg-walker` implements the Eg-walker paper architecture directly.
There is no legacy `crdt/` runtime layer.

## Engine Role

`@softmaple/eg-walker` is the **sequence-model collaboration engine**.
"Engine" is a role defined in
[`docs/design/collaboration-models.md`](../../docs/design/collaboration-models.md):
the convergence implementation for one collaboration model.

This package owns the **sequence model** only — a flat sequence of
code units / graphemes with index-based `insert(index, text)` and
`delete(index, length)` operations. The block model (rich text /
node-tree) and object model (canvas / scene) are separate models with
separate engines (not yet implemented). They are **siblings, not
subclasses** of this package, and there is intentionally no shared
engine base type.

Surfaces never import this package directly; they go through a
**surface binding** (see
[`docs/design/surface-bindings.md`](../../docs/design/surface-bindings.md)).
Awareness and transports are separate concerns and must not be
imported here.

## Layering Rules (Source of Truth)

The cross-package boundaries for `@softmaple/eg-walker`,
`@softmaple/awareness`, and `apps/*` are defined in
[`docs/design/collaboration-layers.md`](../../docs/design/collaboration-layers.md).
That document is the source of truth and is enforced mechanically by
the `egWalkerCollaborationConfig` export from
`@softmaple/eslint-config/collaboration-layers`.

In short, this package MUST NOT depend on `@softmaple/awareness`, on
any editor framework (`lexical`, `prosemirror-*`, `slate` / `slate-*`),
or expose anything other than index-based operations on its public
API. Read the layering doc before adding or moving public exports.

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

Standalone performance harnesses, their fixtures, and paper-aligned measurement
documentation live in `packages/bench`. Run them through
Turborepo so this compiled package is built first:

```bash
pnpm exec turbo run bench --filter=@softmaple/bench
pnpm exec turbo run paper-bench \
  --filter=@softmaple/bench -- \
  --datasets S1 \
  --runs 1
```

Keep assertion-based performance regression tests that enforce engine
invariants in this package's `src/test/` tree.
