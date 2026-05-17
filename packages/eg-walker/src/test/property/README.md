# eg-walker property tests

`fast-check`-driven property tests for `@softmaple/eg-walker`. Each file
in this directory pins one invariant of the engine and exercises it
against shrunk inputs, so a failing case reduces to a minimal
script + delivery permutation instead of an opaque seed.

## Run count

Every property uses a shared run-count knob defined in
[`run-config.ts`](./run-config.ts). The default is **100 runs per
property** (the acceptance criterion on softmaple/softmaple issue
`#722`). Override it from the shell:

```bash
# Default — 100 runs per property.
pnpm --filter @softmaple/eg-walker test

# Cheap smoke run — 10 runs per property. Useful when iterating.
EG_WALKER_PROPERTY_RUNS=10 pnpm --filter @softmaple/eg-walker test --run src/test/property

# Recommended pre-release sweep — 500 runs per property.
EG_WALKER_PROPERTY_RUNS=500 pnpm --filter @softmaple/eg-walker test
```

The variable is declared on the turbo `test` task in `turbo.json`, so
`turbo/no-undeclared-env-vars` is satisfied and the cache key picks it
up automatically.

## Layout

| File | Property |
| --- | --- |
| [`convergence.property.test.ts`](./convergence.property.test.ts) | Every shuffled delivery order of a trace matches the canonical replay text. |
| [`delivery-order-invariance.property.test.ts`](./delivery-order-invariance.property.test.ts) | For a *fixed* event set, every permutation lands on the canonical text. |
| [`duplicate-event-idempotency.property.test.ts`](./duplicate-event-idempotency.property.test.ts) | Re-applying every event leaves replica state unchanged. |
| [`missing-parent-buffering.property.test.ts`](./missing-parent-buffering.property.test.ts) | Events delivered before their parents are buffered and flushed to the canonical text. |
| [`serialize-roundtrip.property.test.ts`](./serialize-roundtrip.property.test.ts) | JSON `serialize`/`deserialize` and columnar `encodeBinary`/`decodeBinary` preserve text and frontier. |
| [`unicode-surrogate.property.test.ts`](./unicode-surrogate.property.test.ts) | Surrogate-biased traces stay well-formed UTF-16 and converge under random delivery. |

## Shared helpers

| File | Purpose |
| --- | --- |
| [`arbitraries.ts`](./arbitraries.ts) | Shared `fast-check` arbitraries (replica ids, BMP/surrogate-biased text, edit instructions, multi-replica `TraceParams`, explicit DAGs). |
| [`trace-runner.ts`](./trace-runner.ts) | Drives a fleet of `EgWalkerReplica` instances through a `TraceParams` script, returns the deduplicated event list, canonical replay text, per-replica final text, and the applied-edit count. |
| [`run-config.ts`](./run-config.ts) | Centralises the `numRuns` knob and the `EG_WALKER_PROPERTY_RUNS` override. |
| [`utf16.ts`](./utf16.ts) | UTF-16 well-formedness predicate for the surrogate test. |

## Adding a new property test

1. Add a new `*.property.test.ts` file in this directory — one property
   per file so a failing run is easy to attribute. The filename should
   describe the invariant (e.g. `causal-consistency.property.test.ts`).
2. Compose existing arbitraries from `arbitraries.ts` where possible.
   New shared generators (used by ≥ 2 properties) belong there too;
   one-off generators can stay in the test file.
3. Call `runTrace(params)` from `trace-runner.ts` whenever you need a
   realistic multi-replica event set. The runner is deterministic in
   its inputs, so a shrunk `TraceParams` is enough to reproduce a
   failure outside fast-check.
4. Pass `fcParams()` (from `run-config.ts`) as the second argument to
   `fc.assert` so your test respects the
   `EG_WALKER_PROPERTY_RUNS` override.
5. Guard against trivially empty traces with
   `fc.pre(trace.appliedEdits > 0)` rather than `if (...) return;` so
   skipped iterations don't silently inflate the reported `numRuns`
   and so fast-check's shrinker stays honest.
