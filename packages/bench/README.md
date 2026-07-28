# @softmaple/bench

Performance harnesses for [`@softmaple/eg-walker`](../eg-walker/README.md).
This private tooling package keeps benchmark code, fixtures, and dependencies
out of the production CRDT package.

## Verification

Run tasks through Turborepo so the compiled `@softmaple/eg-walker` dependency
is built first:

```bash
pnpm exec turbo run lint typecheck --filter=@softmaple/bench
pnpm exec turbo run test --filter=@softmaple/bench -- --run
```

## Vitest Benchmarks

Run all five deterministic scenarios:

```bash
pnpm exec turbo run bench --filter=@softmaple/bench
```

| Scenario                                            | What it stresses                              |
| --------------------------------------------------- | --------------------------------------------- |
| Long linear history (5k sequential inserts)         | Section 3.4 non-conflicting-run fast path     |
| Concurrent same-index inserts (200 events)          | YATA origin-left tie-breaking                 |
| Long offline branch merge (2×1k events)             | Retreat/advance over a stale branch           |
| Delete-heavy workload (2k events, ~70% deletes)     | Delete-target-index and placeholder filtering |
| Checkpoint effectiveness (100 linear + 20 siblings) | `CriticalCheckpointStore` partial replay      |

Each scenario applies its trace to a fresh replica and prints replay counters
after the timed run. `fullReplays`, `partialReplays`, `incrementalApplies`,
`engineRetreats`, checkpoint hits/misses, and current/peak sequence-record
counts make algorithm-path and memory-shape regressions visible alongside
wall-clock results.

## Paper-Aligned Harness

The paper harness consumes the datasets from a sibling
[`egwalker-paper`](https://github.com/josephg/egwalker-paper) checkout. Run it
with:

```bash
pnpm exec turbo run paper-bench \
  --filter=@softmaple/bench -- \
  --datasets S1 \
  --runs 1
```

See [PAPER_BENCHMARKS.md](./PAPER_BENCHMARKS.md) for dataset setup, calibrated
lanes, metrics, guardrails, and reporting guidance.
