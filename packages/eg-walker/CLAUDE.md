# Claude AI Guidelines for eg-walker Package

`@softmaple/eg-walker` implements the Eg-walker paper architecture directly.
There is no legacy `crdt/` runtime layer.

## Current Structure

```text
src/
  constants/operation-types.ts
  core/
    replica.ts
    invariants.ts
    replay-walker.ts
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
  graph/
    event-graph.ts
    columnar-codec.ts
  types/index.ts
```

## Working Rules

- Keep public operations index-based.
- Do not persist or export temporary replay metadata.
- Put causal graph logic in `graph/`.
- Put prepare/effect replay logic in `engine/`.
- Put engine-private helpers (no semver) under `engine/internals/`.
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
