# @softmaple/bench

Performance harnesses for [`@softmaple/eg-walker`](../eg-walker/README.md)
and the [`@softmaple/block-model`](../block-model/README.md) layer built on it.
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

## Block-model edit latency

`block-model-bench` measures a one-character edit on a `@softmaple/block-model`
`BlockReplica` that already holds a long history, typed at the end of the
document through three entry points: a local `transact(insertText)`, a remote
`applyRemoteEvents` of one caught-up peer batch, and a local
`transact(replaceDocument)` the way the Lexical binding commits every editor
update. The history is one author typing
one character per batch, delivered in a single bulk `applyRemoteEvents` call so
setup stays linear in the history on every build. Every process validates the
document text after setup and after the timed edits.

Each process warms up with ten edits of each kind, then rotates through the
three lanes for `--samples` rounds and reports per-lane medians. A fourth lane
then splits the last block at its end and joins the new block back, so every
later mark has a block join in its causal past, and toggles bold on the last
character: ten warm-up toggles, then `--samples` timed ones. It checks the
final bold span along with the text. The driver starts a
fresh process for every implementation, history size and run, alternating the
implementation order between runs, and prints the median of the per-process
medians:

```bash
pnpm exec turbo run block-model-bench --filter=@softmaple/bench -- \
  --batches 50,200,800,3200,10000 --runs 3
```

To compare two builds, build `@softmaple/block-model` in each checkout (for
example a `git worktree` of the base commit) and give each implementation a
unique name:

```bash
pnpm exec turbo run build --filter=@softmaple/block-model
node scripts/run-block-model-bench.mjs \
  --impl base=/path/to/base/packages/block-model/dist/index.js \
  --impl head=../block-model/dist/index.js \
  --batches 50,200,800,3200,10000 --runs 3 --output /path/to/results
```

`--paragraph-length N` starts a new paragraph every `N` characters instead of
typing the whole history into one block. `--output` appends every process's
samples to `runs.jsonl`.

## Snapshot first-edit latency

`snapshot-first-edit-bench` opens a paper dataset with
`EgWalkerReplica.fromPortableSnapshot` and times the first edit, which pays for
the lazy graph decode and the snapshot's text validation, and the edit after it.
Each lane runs in a fresh process, because once one edit has paid for the lazy
work every later operation measures something else:

| Lane                    | First edit                                                                                   | Second edit                 |
| ----------------------- | -------------------------------------------------------------------------------------------- | --------------------------- |
| `local`                 | `insert(0, …)`                                                                               | another local insert        |
| `remote`                | a caught-up peer's insert on the snapshot frontier                                           | the same peer's next insert |
| `concurrent-<d>`        | a peer's insert whose parent is `d` events before the history end                            | the same peer's next insert |
| `native`                | cold load of the same graph bytes (`nativeLoadMs`), for comparison                           | —                           |
| `native-concurrent-<d>` | after a cold load of the decoded graph, a peer's insert whose parent is `d` events back      | the same peer's next insert |

A `local`, `remote` or `concurrent-<d>` lane with one of these prefixes
prepares the replica before its first edit, so the first edit no longer pays
for the restore work. These lanes need a build that has
`EgWalkerReplica.prepare()`:

| Prefix            | Before the first edit                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `prepared-`       | `await replica.prepare()`, time-sliced with its default slice length                                                      |
| `prepared-whole-` | `await replica.prepare({ sliceMs: Infinity })`, in one task, as in a Worker                                               |
| `trusted-`        | the bytes are read with `decodeAuthenticated` and the fixture's tag, then `await replica.prepare()` only decodes the graph |

For every snapshot lane the summary reports the time from the bytes to a
replica that is ready to edit: decode, restore, and `prepare()` or, without
it, the first edit. The prepared lanes also report `prepare()` itself and the
longest task it ran between two yields to the event loop. The fixture step
writes each snapshot's authentication tag next to it, under a fixed bench
key.

The driver prepares one EGWP1 snapshot per dataset (and prefix) with this
checkout's eg-walker, outside any timed region, and measures every
implementation against the same bytes. Every process checks the edited text:
exactly for `local` and `remote`, and for the concurrent lanes by removing both
inserted markers and comparing with the snapshot text. The driver also requires
every implementation to produce the same final text. An EGW4 build reads EGW3
graphs but an EGW3 build cannot read EGW4, so to compare an EGW3 base with an
EGW4 head, run the driver from the base checkout.

```bash
pnpm exec turbo run build --filter=@softmaple/eg-walker
node scripts/run-snapshot-first-edit-bench.mjs \
  --impl base=/path/to/base/packages/eg-walker/dist/index.js \
  --impl head=../eg-walker/dist/index.js \
  --datasets S1,C1,A1,A2 --runs 3 --output /path/to/results
```

`--kinds` selects lanes (default
`native,local,remote,concurrent-10,concurrent-1000`), `--fractions 0.125,0.25`
adds prefixes of each dataset's editing order, and `--reuse-fixtures` keeps the
prepared snapshots of an earlier run in the same `--output`. The driver
alternates implementation order between runs, appends every sample to
`runs.jsonl` and writes the median table to `summary.md`.

### Divergence depth after a cold load

The `native-concurrent-<d>` lanes measure how a replica opened from a decoded
graph merges a peer that diverged `d` events ago. The cold load is timed on its
own as `nativeLoadMs`, so the first edit is only the merge: the partial replay
from the nearest retained checkpoint, or a full replay when none dominates the
divergence. Next to the timings, the summary reports the heap after GC once the
graph is loaded and again after both edits, the checkpoint text the cold load
retained, and how many events the first edit left in the retained replay
engine:

```bash
node scripts/run-snapshot-first-edit-bench.mjs \
  --impl base=/path/to/base/packages/eg-walker/dist/index.js \
  --impl head=../eg-walker/dist/index.js \
  --datasets S1,C1,A1,A2 --runs 5 \
  --kinds native,native-concurrent-10,native-concurrent-100,native-concurrent-1000,native-concurrent-10000 \
  --output /path/to/results
```

## Native snapshot encode

`scripts/run-native-snapshot-encode-bench.mjs` times each step of writing an
EGWS1 snapshot from a replica cold-loaded from a decoded EGW4 graph:
`createNativeSnapshot()` + `NativeSnapshotCodec.encode`, `graph.serialize()`,
`EventGraph.deserialize()`, `encodeTopologicalBinary()` alone, and the
portable create + encode for comparison. Every sample runs in a fresh
process, alternating implementation order between runs; the native bytes are
then decoded and restored, the restored text is checked against the
dataset's final text, and a restore that replays history fails the run.

```bash
node scripts/run-native-snapshot-encode-bench.mjs \
  --impl base=/path/to/base/packages/eg-walker/dist/index.js \
  --impl head=../eg-walker/dist/index.js \
  --datasets S1,S3,C1,A2 --runs 3
```

## Concurrent-edit burst

`concurrent-burst-bench` opens a paper dataset and applies a burst of
`--edits` concurrent inserts from one peer, one `applyRemoteEvent` at a time.
The peer diverged `d` events before the end of the history, and each insert
builds on its previous one. The first edit pays for the merge. Every later
edit is concurrent with the same history, so it stays cheap only while the
replica keeps the replay cache the first edit built. A replica that releases
that cache at its byte budget replays the whole divergent interval again on
every edit.

Each case opens the document one of two ways:

| `--opens`  | Open                                                      | First edit also pays for              |
| ---------- | --------------------------------------------------------- | ------------------------------------- |
| `native`   | cold load: decode the graph and replay it into a replica  | —                                     |
| `portable` | `EgWalkerReplica.fromPortableSnapshot`                    | the lazy graph decode and validation  |

It reuses the snapshot first-edit fixtures. Every process checks the text:
removing the burst's markers must restore the snapshot text, with each marker
in front of the one typed before it, and every implementation must produce the
same final text. For every case and implementation the summary reports:

- the median latency of each edit;
- the replay path each edit took, and the full replays, partial replays and
  incremental applies of the whole burst;
- cache releases: edits that replayed history or started with a cache, and
  ended without one;
- the cache kept after the burst, in events and as the replica's estimate;
- the heap and array buffers after GC, with the replica alive, and the
  process's peak RSS.

With two implementations, it adds a comparison of edit 1, the slowest of the
later edits, memory after GC and peak RSS:

```bash
pnpm exec turbo run build --filter=@softmaple/eg-walker
node scripts/run-concurrent-burst-bench.mjs \
  --impl base=/path/to/base/packages/eg-walker/dist/index.js \
  --impl head=../eg-walker/dist/index.js \
  --datasets S1,C1,A1,A2 --opens native,portable --depths 10,1000,10000 \
  --edits 6 --runs 3 --output /path/to/results
```

`--reuse-fixtures` keeps the prepared snapshots of an earlier run in the same
`--output`. `runs.jsonl` keeps every sample with each edit's replay counters.

## Repeated whole-trace ingest

`repeated-ingest-bench` builds causal batches for a whole paper trace and
applies them to a fresh replica several times in one process. For every
iteration it records the batch-build time (trace conversion through
`createCausalEventBatchBuilder`), the apply time (`applyCausalBatch` and the
final `getText`) and the main-thread GC pause time from `PerformanceObserver`
`gc` entries, charged to the phase each pause started in. Each iteration
drops the previous replica and batches first; `--retain-replicas` keeps every
replica alive instead. The text is checked against the dataset's final text
oracle outside both timers.

A build that keeps no per-event state beyond a replica holds every iteration
close to the first. State that outlives a replica, such as a module-level
collection of every event a builder created, shows up as later iterations
that build, apply or collect garbage more slowly.

The driver bundles the worker from this checkout and starts a fresh process
for every implementation and run, alternating the implementation order:

```bash
pnpm exec turbo run build --filter=@softmaple/eg-walker
node scripts/run-repeated-ingest-bench.mjs \
  --impl base=/path/to/base/packages/eg-walker/dist/index.js \
  --impl head=../eg-walker/dist/index.js \
  --datasets S3 --iterations 3 --runs 3 --output /path/to/results
```

`--apply-batch-events N` builds batches of `N` events instead of one
whole-trace batch. The summary reports per-iteration medians and each
iteration's ratio to the first. A full collection of earlier iterations'
garbage can land in either phase, so apply time is also reported without the
GC pauses that started in it. `--output` receives `summary.md` and
`runs.jsonl`, which keeps every sample with its GC pauses split by phase and
by major and minor collections. Each invocation replaces both files.

## Local keystroke memory

`local-keystroke-memory-bench` types `--count` single-character local inserts
into a fresh replica, appending at the end (`append`) or inserting in the
middle of the document (`middle`). Each sample runs in a fresh `--expose-gc`
process, forces full collections before and after typing, and reports what
the live replica retains per keystroke: JS heap, array buffers (packed and
typed-array columns live outside the JS heap) and their sum.

```bash
pnpm exec turbo run build --filter=@softmaple/eg-walker
node scripts/run-local-keystroke-memory-bench.mjs \
  --impl base=/path/to/base/packages/eg-walker/dist/index.js \
  --impl head=../eg-walker/dist/index.js \
  --count 100000 --modes append,middle --runs 3 --output /path/to/results
```

`--output` receives `summary.md` and `runs.jsonl`; each invocation replaces
both files.

## Concurrent paste merge

`paste-concurrent-bench` measures a large paste that lands in the same replay
section as a concurrent edit. Two replicas share a `--base-length`-character
typed document. One pastes `--sizes` characters into the middle in a single
insert while the other types one character before it, and then each replica
merges the other's event with `applyRemoteEvents`. Both merges replay the
paste and the keystroke in one nonlinear critical section. For each side the
summary reports:

- the merge time;
- the replay engine's `getReplayStats().sequenceRecordCount` and
  `peakSequenceRecordCount` after the merge;
- the JS heap and array buffers the merge retains after full collections.

Each sample runs in a fresh `--expose-gc` process: `--warmup` untimed rounds
of the whole scenario, then one measured round. Every round checks both
replicas' text against the expected document outside the timers. The driver
alternates the implementation order between runs and prints per-side medians:

```bash
pnpm exec turbo run build --filter=@softmaple/eg-walker
node scripts/run-paste-concurrent-bench.mjs \
  --impl base=/path/to/base/packages/eg-walker/dist/index.js \
  --impl head=../eg-walker/dist/index.js \
  --sizes 10000,100000 --runs 3 --output /path/to/results
```

`--output` receives `summary.md` and `runs.jsonl`; each invocation replaces
both files.

## Wide-frontier receive

`wide-frontier-bench` measures receiving many concurrent edits at once, as
when many peers come back online with independent edits. `--events` replicas
each insert one letter at index 0 with no parents, so the receiver's frontier
grows to one event per replica. A fresh replica receives them one
`applyRemoteEvent` call at a time (`single`) or as one `applyRemoteEvents`
batch (`batch`); only the receive is timed. For each event count and API the
summary reports:

- the receive time and the time per event;
- the time per event divided by the time per event at the smallest
  `--events`, which stays near 1 while receiving is linear in the frontier
  width.

Each sample runs in a fresh process: one untimed round of `--warmup-events`
events, then the measured round. Outside the timer, every round checks that
the frontier holds every event and that the text has every inserted letter,
and the driver requires every implementation and API to produce the same text
for a given event count. It alternates the implementation order between runs:

```bash
pnpm exec turbo run build --filter=@softmaple/eg-walker
node scripts/run-wide-frontier-bench.mjs \
  --impl base=/path/to/base/packages/eg-walker/dist/index.js \
  --impl head=../eg-walker/dist/index.js \
  --events 1000,2000,4000,8000,16000 --runs 3 --output /path/to/results
```

`--apis single` or `--apis batch` runs one API. `--output` receives
`summary.md` and `runs.jsonl`; each invocation replaces both files.

## Sustained-concurrency typing

`sustained-concurrency-bench` measures live collaboration where every writer
keeps typing while edits are in flight. `--writers` replicas each type one
letter per step at their own cursor, `--events` letters in all, and every edit
reaches the other writers and a relay, which never types, 1 to `--max-delay`
steps later. After the first steps the history has no critical version, so a
replica that releases its replay cache can rebuild it only by replaying the
whole history. Each replica receives the edits that arrive from one writer in
a step one `applyRemoteEvent` call at a time (`single`) or as one
`applyRemoteEvents` batch (`batch`). For each writer count, event count and
API the summary reports:

- the time in every replica call, in receives, and in the relay's receives;
- the time per typed letter, and that time divided by the time per letter at
  the smallest `--events`, which stays near 1 while the session is linear in
  its length;
- full replays, partial replays and replay-cache releases, summed over the
  writers and the relay.

Each sample runs in a fresh process: one untimed session of `--warmup-events`
letters, then the measured one. Outside the timer, every session checks that
all replicas converge on text with every typed letter, and the driver requires
every implementation and API to produce the same text for a given writer and
event count. It alternates the implementation order between runs:

```bash
pnpm exec turbo run build --filter=@softmaple/eg-walker
node scripts/run-sustained-concurrency-bench.mjs \
  --impl base=/path/to/base/packages/eg-walker/dist/index.js \
  --impl head=../eg-walker/dist/index.js \
  --writers 2,3 --events 2000,4000,8000 --max-delay 10 --runs 3 \
  --output /path/to/results
```

`--apis single` or `--apis batch` runs one API. `--output` receives
`summary.md` and `runs.jsonl`; each invocation replaces both files.

## Same-position cold replay

`same-position-bench` measures replaying many concurrent inserts at one
position, the worst case for the integration scan. `--events` replicas each
insert one letter at the same position, all concurrent with one another, in
each of three `--shapes`:

| Shape    | History                                                              |
| -------- | -------------------------------------------------------------------- |
| `root`   | parentless inserts at index 0                                        |
| `after`  | a base insert, then inserts at index 1 whose only parent is the base |
| `before` | a base insert, then inserts at index 0 whose only parent is the base |

Replica IDs ascend with the insert order, so every insert sorts after the
earlier ones and a linear scan would cross all of them. The history is encoded
as EGW4 and decoded outside the timer; the measured cold replay builds a
replica from the decoded graph and reads its text. For each count and shape
the summary reports:

- the replay time and the time per event;
- the time per event divided by the time per event at the smallest
  `--events`, which grows only logarithmically while the replay is
  O(n log n);
- the scan probes and integration-index builds of the replay.

Each sample runs in a fresh process: one untimed round of `--warmup-events`
events, then the measured round. Every round checks the exact text, and the
driver requires every implementation to produce the same text for a given
shape and count. It alternates the implementation order between runs:

```bash
pnpm exec turbo run build --filter=@softmaple/eg-walker
node scripts/run-same-position-bench.mjs \
  --impl base=/path/to/base/packages/eg-walker/dist/index.js \
  --impl head=../eg-walker/dist/index.js \
  --events 1000,10000,100000 --runs 3 --output /path/to/results
```

`--output` receives `summary.md` and `runs.jsonl`; each invocation replaces
both files.

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

Replay work in `paper-bench` and the streaming summaries uses replica-lifetime
counters, so `retreats`, `advances`, and structural work survive cache eviction.
The output also reports `fullReplayEvents`, `partialReplayEvents`,
`replayedEvents`, cache evictions, budget refusals, and the current byte budget.
The snapshot first-edit table reports the retained cache size separately from
the **delta** in replayed events and transitions between cold open and first
edit. Older implementation bundles without these counters show `n/a` for the
new rows; cache size is never substituted for missing work counters.

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

The comparison driver runs all seven datasets by default; an optional final
argument selects a comma-separated subset (for example, `apply 21 C1` for
additional samples of a noisy lane). It runs without event/transaction
limits, with a fresh process per sample and alternating version order. It uses
4096-event causal batches in the isolated apply lane and the existing detailed
receive/persistence harness in the persistence lane. It records each command,
exit status, elapsed time and peak RSS. Failed validation is preserved and
stops repeated samples for that version/dataset; it is never a speedup sample.
Each process has a 6656 MiB V8 heap limit and a ten-minute timeout. Use a new
output directory for every comparison. `benchmark-worker.mjs` obtains peak RSS
from Node itself, so GNU `time` is not required.

For whole-trace causal apply and isolated native decode + cold replay (the
#982 lanes), use `apply-all` and `native` respectively. Both use the same
fresh-process, alternating-order protocol; the driver uses Node's timeout
on macOS and Linux, without requiring GNU `timeout`:

```bash
node scripts/compare-paper-bench.mjs \
  /tmp/before/paper-bench.mjs /tmp/after/paper-bench.mjs \
  /path/to/egwalker-paper /path/to/results/apply-all apply-all 3
node scripts/compare-paper-bench.mjs \
  /tmp/before/paper-bench.mjs /tmp/after/paper-bench.mjs \
  /path/to/egwalker-paper /path/to/results/native native 3
```

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

Raw comparison output is not checked in. Write every run to a directory outside
the repository and keep the raw samples with the report that cites them.

All benchmark tasks disable Turborepo result caching: a timing run must execute
on the current machine. Library build artifacts can still come from the build
cache. Run the Vitest suite directly when collecting A/B measurements, so that
no timing is restored from a task cache.
