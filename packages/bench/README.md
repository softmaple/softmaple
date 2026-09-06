# @softmaple/bench

Performance harnesses for [`@softmaple/eg-walker`](../eg-walker/README.md).
This private tooling package keeps benchmark code, fixtures, and dependencies
out of the production CRDT package.

## Architecture

```text
      vitest bench                             paper-bench
 5 deterministic traces                  egwalker-paper datasets
            │                                       │
            └───────────────────┬───────────────────┘
                                │
                  fresh EgWalkerReplica per run
                                │
                      @softmaple/eg-walker
                      built first by turbo
                                │
            ┌───────────────────┴───────────────────┐
            │                                       │
       wall clock                            replay counters
      per scenario                        full/partial replays
                                     checkpoint hits · peak records
```

Wall clock alone hides algorithm regressions: a change that silently turns
partial replays into full ones can still look fast on a small trace. Reading
the counters next to the timings is what makes an algorithm-path or
memory-shape regression visible.

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

## Replay optimization A/B workers

`replay-bench` adds full-text-checked threshold, receive API, graph import and
cold portable snapshot cases. It accepts an explicit built implementation so
before/after versions can be measured without editing production files:

```bash
pnpm exec turbo run replay-bench --filter=@softmaple/bench -- \
  /absolute/path/to/eg-walker/dist/index.js offline-2100 64 detailed
```

Scenarios: `linear` (10k), `linear-5000`, `concurrent` (200), `offline-N`
(N events per branch), `delete` (2k), `checkpoint` (120). Modes: `detailed`,
`causal`, `import`, `snapshot-local`, `snapshot-remote`. The worker warms twice,
then records five full trials with GC outside the timed work. It reports
builder, apply, text materialization, snapshot decode/restore/first edit,
replay counters, memory usage and process peak RSS. Snapshot bytes are copied
before decode; the first edit includes lazy graph decode and text validation.
Hashes must match across the A/B matrix, including concurrent cases without an
independent expected-text oracle.

For complete paper comparisons, build eg-walker in each checkout first with
`pnpm exec turbo run build --filter=@softmaple/eg-walker`. Then, from that
checkout's `packages/bench`, bundle the harness with its own implementation
(use different output directories for before and after):

```bash
node --input-type=module <<'JS'
import { build } from "tsup";
await build({
  entry: { "paper-bench": "src/bench/paper-bench.ts" },
  outDir: "/tmp/before",
  format: ["esm"],
  outExtension: () => ({ js: ".mjs" }),
  platform: "node",
  noExternal: [/.*/],
  splitting: false,
  dts: false,
  minify: false,
  sourcemap: false,
});
JS
```

Run the comparison scripts from the current `packages/bench`:

```bash
node scripts/compare-paper-bench.mjs \
  /tmp/before/paper-bench.mjs /tmp/after/paper-bench.mjs \
  /path/to/egwalker-paper /path/to/results/full apply 3
node scripts/compare-paper-bench.mjs \
  /tmp/before/paper-bench.mjs /tmp/after/paper-bench.mjs \
  /path/to/egwalker-paper /path/to/results/full persistence 3
```

The Linux comparison driver runs all seven datasets without event/transaction
limits, with a fresh process per sample and alternating version order. It uses
4096-event causal batches in the isolated apply lane and the existing detailed
receive/persistence harness in the persistence lane. It records each command,
exit status, elapsed time and peak RSS. Failed validation is preserved and
stops repeated samples for that version/dataset; it is never a speedup sample.
Each process has a 6656 MiB V8 heap limit and a ten-minute timeout. Use a new
output directory for every comparison. `benchmark-worker.mjs` obtains peak RSS
from Node itself, so GNU `time` is not required.

For the 20-case focused matrix, use the same bundling snippet in the current
checkout with `entry: { "replay-optimization": "src/bench/replay-optimization.ts" }`
and `outDir: "/tmp/workers"`, then run:

```bash
node scripts/compare-replay-bench.mjs /tmp/workers/replay-optimization.mjs \
  /path/to/before/packages/eg-walker/dist/index.js \
  /path/to/after/packages/eg-walker/dist/index.js /path/to/results/focused
node scripts/summarize-replay-comparison.mjs /path/to/results
```

The dynamically imported builds must retain access to their runtime dependencies
(`lz4js`); keep them inside their installed checkouts, or link the corresponding
`node_modules` next to an isolated `dist` copy. Each worker measures five trials;
the driver requires every final text hash to match across both versions.

The [2026-09-06 comparison](./results/2026-09-06-eg-walker/REPORT.md) includes
all raw samples, the full persistence lanes, memory measurements, validation
failures and a follow-up on small-workload timing variation.

All benchmark tasks disable Turborepo result caching: a timing run must execute
on the current machine. Library build artifacts can still come from the build
cache. The A/B measurements in the accompanying report ran the original Vitest
suite directly, so none of its timings were restored from a task cache.
