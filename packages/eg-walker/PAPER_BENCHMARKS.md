# Eg-walker Paper-Aligned Benchmarks

This document describes how to benchmark `@softmaple/eg-walker` against the
datasets and measurement style used by the Eg-walker paper:

> Collaborative Text Editing with Eg-walker: Better, Faster, Smaller

The goal is not to reproduce the paper's Rust Diamond Types numbers inside this
TypeScript package. The goal is to build a repeatable local benchmark that uses
the same editing traces, records the same classes of metrics, and makes the
comparison boundaries explicit.

## Reference Artifact

The paper artifact lives outside this package. Pass `--paper-root` if your
checkout is not at the default local path:

```text
/Users/zhyd1997/workspaces/oss/egwalker-paper
```

The useful files are:

```text
datasets/S1.json ... datasets/A2.json
datasets/S1.yjs  ... datasets/A2.yjs
results/timings.json
results/*_memusage.json
```

The paper datasets are:

| Dataset | Shape        | Notes                                  |
| ------- | ------------ | -------------------------------------- |
| `S1`    | sequential   | repeated Automerge paper editing trace |
| `S2`    | sequential   | repeated blog editing trace            |
| `S3`    | sequential   | Eg-walker paper editing trace          |
| `C1`    | concurrent   | collaborative Friends Forever trace    |
| `C2`    | concurrent   | collaborative Clown School trace       |
| `A1`    | asynchronous | Node.js source history trace           |
| `A2`    | asynchronous | Git Makefile history trace             |

The paper's published results were collected on a Ryzen 7950X running Linux with
64 GB RAM. Rust benchmarks were compiled in release mode and pinned to one CPU
core. JavaScript/Yjs was run with Node.js v22.2.0. Local results on macOS,
Apple Silicon, and Node v24 are useful, but absolute timings should not be
compared directly with the paper's table.

## Comparison Boundaries

There are three distinct benchmark modes. Keep them separate in reports.

### 1. Yjs Native Baseline

The paper's Yjs benchmark loads precomputed Yjs binary updates:

```js
Y.applyUpdateV2(doc, data);
```

This measures Yjs native update application, not JSON trace import. It is a
good local baseline for "how fast does a mature JavaScript CRDT load its native
payload on this machine?"

Run it from the paper repo:

```bash
cd /Users/zhyd1997/workspaces/oss/egwalker-paper/tools/bench-yjs
npm i
node bench-remote.js
```

Optional memory benchmark:

```bash
node --expose-gc bench-memusage.js
```

The remote-time benchmark writes:

```text
/Users/zhyd1997/workspaces/oss/egwalker-paper/results/js.json
```

The memory benchmark writes:

```text
/Users/zhyd1997/workspaces/oss/egwalker-paper/results/yjs_memusage.json
```

### 2. SoftMaple Raw Trace Ingest

This benchmark imports the paper JSON trace and applies events through
`EgWalkerReplica.applyRemoteEvent`.

This is useful as a stress test for this package:

- Can it ingest paper-scale traces?
- Does it converge to `endContent`?
- Which datasets trigger slow replay paths?
- Do optimizations improve the same workload over time?

It is not a strict apples-to-apples comparison with Yjs native binary update
loading, because this path includes JSON parsing, trace conversion, TypeScript
object allocation, `Set`/`Map` operations, and per-event API overhead.

### 3. SoftMaple Native Payload Load

This is the fairer comparison to Yjs native update loading. The plan is:

1. Convert each paper JSON trace into this package's own persistent format.
2. Write native payload files such as `S1.egw`, `S2.egw`, ...
3. Benchmark native decode/load separately from raw JSON import.

The closest current APIs are:

- `EgWalkerReplica.serialize()`
- `EgWalkerReplica.deserialize(...)`
- `ColumnarEventGraphCodec.encodeBinary(...)`
- `ColumnarEventGraphCodec.decodeBinary(...)`

The current native snapshot benchmark records this mode in two forms:

- `nativeDecodeMs` / `nativeLoadMs`: the old EGW3 columnar graph path followed
  by `new EgWalkerReplica(..., decodedGraph)`, which still replays history.
- `snapshotEncodeMs` / `snapshotDecodeMs` / `snapshotRestoreMs`: the native
  snapshot path. `snapshotRestoreMs` is expected to avoid full replay for
  read-only load; the first edit after restore still lazily rebuilds replay
  state in the current Phase 1 implementation.

## Paper JSON Shape

Each `datasets/*.json` file contains:

```ts
type PaperTrace = {
  kind: string;
  endContent: string;
  numAgents: number;
  txns: PaperTxn[];
};

type PaperTxn = {
  parents: number[];
  numChildren: number;
  agent: number;
  time: string;
  patches: PaperPatch[];
  _dtSpan?: [number, number];
};

type PaperPatch = [index: number, deleteLength: number, insertedText: string];
```

`parents` contains transaction indexes. It does not contain SoftMaple event IDs.

## Patch-Level Conversion

The current implementation supports patch-level conversion:

```text
paper txn patch -> one delete event, one insert event, or both
```

Patch-level conversion keeps the benchmark practical and is sufficient for a
package-level ingest and replay stress test on the sequential datasets
(`S1`, `S2`, `S3`) and bounded concurrent samples. It is not faithful enough for
every asynchronous trace; see [Operation-Level Conversion](#operation-level-conversion).

Conversion rules:

- Maintain `txnLastEventId: Array<EventId | null>`.
- Convert each paper txn's parent indexes to a `parentVersion` set containing
  the last event ID produced by each parent txn.
- Process patches in order.
- If `deleteLength > 0`, emit a delete `GraphEvent`.
- If `insertedText !== ""`, emit an insert `GraphEvent`.
- Events produced by later patches in the same txn should parent the previous
  event emitted by that txn, so patch order is preserved.
- If a txn produces no event, record its effective parent frontier for child
  txns.
- Paper trace positions are Unicode scalar offsets. `@softmaple/eg-walker`
  public operations use UTF-16 code-unit offsets, so conversion maps indexes and
  delete lengths before creating `GraphEvent`s. This matters for `S3`, which
  otherwise leaves a 14-code-unit tail mismatch.

SoftMaple event shape:

```ts
type GraphEvent = {
  id: string;
  parentVersion: Set<string>;
  operation:
    | { type: "insert"; index: number; text: string }
    | { type: "delete"; index: number; length: number };
  timestamp: number;
};
```

Suggested event IDs:

```text
paper:{dataset}:txn:{txnIndex}:patch:{patchIndex}:del
paper:{dataset}:txn:{txnIndex}:patch:{patchIndex}:ins
```

If both delete and insert are emitted for one patch, make the insert parent the
delete event.

## Current Script

The package script is:

```json
{
  "scripts": {
    "paper-bench": "tsx src/bench/paper-bench.ts"
  }
}
```

Baseline commands:

```bash
pnpm --filter @softmaple/eg-walker paper-bench -- --datasets S1 --runs 1
pnpm --filter @softmaple/eg-walker paper-bench -- --datasets S1,S2,S3 --runs 1
```

Phase 0 guardrail suite:

```bash
pnpm --filter @softmaple/eg-walker paper-bench -- \
  --paper-root /path/to/egwalker-paper \
  --plan-phase0 \
  --runs 1
```

This runs:

- `S1`, `S2`, `S3`, and `A1` at full trace size.
- `C1` and `C2` bounded to `--max-events 3000` and `--max-events 10000`.

Use memory mode for a separate `node --expose-gc` worker per case:

```bash
pnpm --filter @softmaple/eg-walker paper-bench -- \
  --paper-root /path/to/egwalker-paper \
  --plan-phase0 \
  --runs 1 \
  --memory
```

Important output fields:

- `jsonBytes`: JSON `serialize()` payload size.
- `binaryBytes`: EGW3 columnar graph payload size.
- `snapshotBytes`: native snapshot payload size.
- `nativeDecodeMs`: EGW3 graph decode time.
- `nativeLoadMs`: old graph-backed replica load time, including replay.
- `snapshotEncodeMs`: native snapshot encode time.
- `snapshotDecodeMs`: native snapshot byte decode time.
- `snapshotRestoreMs`: replica construction from decoded snapshot, without
  historical replay for read-only load.
- `snapshotFullReplays` / `snapshotPartialReplays` /
  `snapshotIncrementalApplies`: replay counters observed on the restored
  snapshot replica. `snapshotFullReplays` must stay `0` for Phase 1 read-only
  restore.
- `snapshotDecodeHeapBytes` / `snapshotRestoreHeapBytes`: memory deltas from
  the explicit memory worker.

Do not use full `--datasets all` as the first routine check. Full `C1` and
`C2` are currently dominated by replay cost. Use bounded concurrent/asynchronous
smoke tests first:

```bash
pnpm --filter @softmaple/eg-walker paper-bench -- \
  --datasets C1 \
  --runs 1 \
  --max-txns 3000

pnpm --filter @softmaple/eg-walker paper-bench -- \
  --datasets C2 \
  --runs 1 \
  --max-txns 3000

pnpm --filter @softmaple/eg-walker paper-bench -- \
  --datasets A2 \
  --runs 1 \
  --max-txns 300 \
  --granularity operation
```

The script defaults to the local paper artifact root:

```text
/Users/zhyd1997/workspaces/oss/egwalker-paper
```

It also accepts an override:

```bash
pnpm --filter @softmaple/eg-walker paper-bench -- \
  --datasets all \
  --runs 3 \
  --paper-root /path/to/egwalker-paper
```

Optional native-load memory measurement runs a second isolated process with
`node --expose-gc` and prints a `paper-bench-memory` line:

```bash
pnpm --filter @softmaple/eg-walker paper-bench -- \
  --datasets S1 \
  --runs 1 \
  --memory
```

## Operation-Level Conversion

Patch-level conversion is fast enough to start with, but it is not faithful
enough for every concurrent/asynchronous trace. In particular, a patch that
inserts a long string collapses many paper event-graph nodes into one SoftMaple
event. Later concurrent operations may depend on positions inside that inserted
run. Collapsing the run can make a later operation's parent-version index invalid
during replay.

Use operation-level conversion for faithful paper semantics:

```bash
pnpm --filter @softmaple/eg-walker paper-bench -- \
  --datasets A2 \
  --runs 1 \
  --granularity operation
```

Operation-level conversion uses each transaction's `_dtSpan` and emits one
SoftMaple event per paper keystroke:

- a delete patch of length `n` emits `n` single-character delete events;
- an inserted string emits one insert event per character;
- event IDs use the paper logical version: `paper:{dataset}:lv:{number}`;
- a transaction's child frontier is the last emitted operation in its span.

This mode is much slower, but it is the right mode for correctness checks on
traces where patch-level indexes depend on positions inside a long inserted run.
`A2` is the current concrete case: patch-level full ingest fails at txn 289 with
an out-of-bounds insert, while the bounded operation-level smoke test passes:

```bash
pnpm --filter @softmaple/eg-walker paper-bench -- \
  --datasets A2 \
  --runs 1 \
  --max-txns 300 \
  --granularity operation
```

## Metrics To Print

For each dataset and run:

```text
dataset
run
txns
patches
events
text
loadConvertMs
applyMs
totalMs
jsonBytes
binaryBytes
nativeDecodeMs
nativeLoadMs
snapshotEncodeMs
snapshotDecodeMs
snapshotRestoreMs
snapshotFullReplays
snapshotPartialReplays
snapshotIncrementalApplies
fullReplays
partialReplays
incrementalApplies
retreats
advances
checkpointHits
checkpointMisses
sequenceRecords
peakSequenceRecords
```

`text` is the final text length in UTF-16 code units. `loadConvertMs` includes
reading the JSON trace and converting it into `GraphEvent`s. `nativeDecodeMs`
measures `ColumnarEventGraphCodec.decodeBinary(...)`; `nativeLoadMs` measures
constructing an `EgWalkerReplica` from the decoded graph and replaying it to
plain text.

When `--memory` is set, each run also prints:

```text
heapBeforeBytes
heapAfterDecodeBytes
heapAfterLoadBytes
nativeDecodeHeapBytes
nativeLoadHeapBytes
```

These are collected in a separate `node --expose-gc` process after building the
native binary payload, so they measure native binary decode and native graph
load without retaining the parent benchmark's heap.

After all runs, print at least:

```text
meanApplyMs
minApplyMs
maxApplyMs
meanTotalMs
```

The benchmark must fail if:

- any remote events remain buffered;
- `replica.getText() !== trace.endContent` for unbounded runs where the chosen
  granularity is expected to be faithful;
- snapshot restore performs a full replay;
- binary encode/decode round-trip fails once native payload measurement is
  added.

## Expected Runtime

Current local baseline for patch-level raw ingest on this Mac / Node v24:

```text
S1: ~8.2s total
S1 native decode/load: ~0.23s decode, ~7.7s load
S1 native memory: ~145 MB decode heap, ~389 MB load heap
S2: ~14.4s total
S2 native decode/load: ~0.17s decode, ~21.5s load
S3: ~24.7s total
S3 native decode/load: ~0.24s decode, ~31.0s load
S1/S2/S3 together: ~47s total
A1 full: ~41.9s total
A1 native decode/load: ~0.08s decode, ~6.9s load
C1 max-txns 3000: ~5.1s total
C1 max-txns 3000 native decode/load: ~0.01s decode, ~0.06s load
C2 max-txns 3000: ~5.0s total
C2 max-txns 3000 native decode/load: ~0.01s decode, ~0.04s load
C1 max-txns 10000: ~63.6s total
C2 max-txns 10000: ~56.9s total
A2 max-txns 300 operation-level: ~10.9s total
A2 max-txns 600 operation-level: ~129.9s total
```

Collected local baseline on 2026-06-04 with Node v24.12.0:

```text
Command: pnpm paper-bench -- --datasets S1,S2,S3 --runs 3
S1: mean total 8.74s, native decode 0.245s, native load 7.74s
S2: mean total 15.36s, native decode 0.097s, native load 14.89s
S3: mean total 25.51s, native decode 0.125s, native load 25.49s

Command: pnpm paper-bench -- --datasets A1 --runs 3
A1 full: mean total 42.09s, native decode 0.060s, native load 5.73s

Command: pnpm paper-bench -- --datasets C1,C2 --runs 3 --max-txns 3000
C1 max-txns 3000: mean total 4.55s, native decode 0.009s, native load 0.046s
C2 max-txns 3000: mean total 4.47s, native decode 0.005s, native load 0.028s

Command: pnpm paper-bench -- --datasets A2 --runs 3 --max-txns 300 --granularity operation
A2 max-txns 300 operation-level: mean total 10.90s, native decode 0.039s, native load 0.315s

Command: pnpm paper-bench -- --datasets S1 --runs 1 --memory
S1 native memory: 143,488,960 bytes decode heap, 389,254,424 bytes load heap
```

The 2026-06-04 data points to two different bottleneck classes:

- Sequential `S1`/`S2`/`S3` native load remains replay/materialization-bound;
  binary decode is consistently sub-second.
- `A1`, bounded `C1`/`C2`, and bounded operation-level `A2` have much faster
  native load than raw ingest, so their next optimization target is the
  per-event remote apply path and replay churn.

After optimizing checkpoint criticality checks on 2026-06-04, bounded
`C1`/`C2` improved substantially because `pickFor` no longer expands the full
checkpoint ancestor history on every divergent event:

```text
Command: pnpm paper-bench -- --datasets C1,C2 --runs 3 --max-txns 3000
C1 max-txns 3000: mean total 2.10s, mean apply 2.03s, native load 0.044s
C2 max-txns 3000: mean total 2.05s, mean apply 1.97s, native load 0.029s

Command: pnpm paper-bench -- --datasets A1 --runs 1
A1 full smoke: total 39.32s, apply 39.28s, native load 5.57s

Command: pnpm paper-bench -- --datasets A2 --runs 1 --max-txns 300 --granularity operation
A2 max-txns 300 operation-level smoke: total 10.55s, apply 10.51s, native load 0.291s
```

Passing the already-computed partial-replay suffix order into
`EgWalkerEngine.generate` avoids rebuilding full-graph topological order during
each checkpoint replay. The same bounded `C1`/`C2` command then improved again:

```text
Command: pnpm paper-bench -- --datasets C1,C2 --runs 3 --max-txns 3000
C1 max-txns 3000: mean total 1.57s, mean apply 1.50s, native load 0.048s
C2 max-txns 3000: mean total 1.52s, mean apply 1.44s, native load 0.033s
```

The same optimized path now makes bounded 10k concurrent samples practical as
smoke checks:

```text
Command: pnpm paper-bench -- --datasets C1,C2 --runs 1 --max-txns 10000
C1 max-txns 10000: total 16.37s, apply 16.27s, native load 0.244s
C2 max-txns 10000: total 14.85s, apply 14.76s, native load 0.223s
```

Full `C1`/`C2` patch-level runs are still not routine checks; bounded 10k
samples are now the larger smoke profile, while bounded 3k samples remain the
fast regression profile.

If inserted strings are split into single-character events, the event count rises
to paper keystroke scale. A bounded `A2` sample of 300 txns / 46,540 events now
takes about 11 seconds locally; 600 txns / 95,257 events takes about 130
seconds. A `--max-events 100000` probe exceeded two minutes and was stopped, so
keep `A2 --max-txns 300 --granularity operation` as the routine faithful smoke
test. Do not start with full operation-level mode for routine regression checks.

Yjs native baseline should be much faster:

```text
remote-time benchmark: usually 1-3 minutes
memory benchmark: usually 10-60 seconds
```

This difference is expected because Yjs is loading precomputed native binary
updates, while raw SoftMaple ingest is importing JSON and applying TypeScript
event objects one by one.

## Reporting Guidance

Use this wording in reports:

- "SoftMaple raw ingest" for JSON trace conversion plus `applyRemoteEvent`.
- "SoftMaple native load" for `deserialize` or binary codec load.
- "Yjs native update" for `Y.applyUpdateV2` on `datasets/*.yjs`.
- "Paper DT" for the Rust Diamond Types results in `egwalker-paper/results`.

Avoid saying that raw ingest is faster or slower than Yjs as an algorithmic
claim. It is an engineering throughput comparison with different input formats.

The useful comparison matrix is:

| Comparison                                    | Meaning                   |
| --------------------------------------------- | ------------------------- |
| SoftMaple raw ingest before vs after a change | Regression signal         |
| SoftMaple native load vs Yjs native update    | Runtime experience signal |
| SoftMaple results vs paper DT                 | Optimization headroom     |
| Dataset S vs C/A timing shape                 | Algorithm path health     |

## Current Status And Remaining Work

Done:

1. `paper-traces.ts` implements patch-level and operation-level conversion.
2. `paper-bench.ts` supports `--datasets`, `--runs`, `--paper-root`,
   `--max-txns`, `--max-events`, and `--granularity`.
3. `S1,S2,S3 --runs 1` passes in patch mode.
4. `A1 --runs 1` passes in patch mode.
5. `C1` and `C2` pass bounded `--max-txns 3000` and `--max-txns 10000`
   patch-mode samples.
6. `A2 --max-txns 300 --granularity operation` passes.
7. Bounded `C1`/`C2 --max-txns 3000` apply time improved from roughly
   4.4-4.5s to roughly 1.4-1.5s through checkpoint criticality and partial
   replay ordering optimizations.

Next:

1. Decide whether to attempt full `C1`/`C2` patch-level runs as a separate
   long-run profile. They are no longer blocked by the 10k smoke cost, but they
   should still stay out of routine regression checks until full runtime is
   measured.
2. Profile the optimized `C1`/`C2` path before the next runtime change. The
   remaining hot spots are now spread across insert handling, indexed sequence
   updates, and `diffVersions`, not a single obvious full-history scan.
3. Decide whether `A2` should support a faster faithful mode than full
   operation-level conversion. The current operation-level path is correct for
   bounded samples but grows too quickly past the 300-txn smoke test.
4. Native binary decode/load timings are now printed for each run. Initial S1
   data shows binary decode is fast, while sequential loading still pays the
   full replay cost. Bounded `C1`/`C2` native loads are much faster than raw
   ingest because they avoid per-event remote-apply replay churn and replay the
   decoded graph once in branch-preserving order.
5. Optional memory measurement is available through `--memory`; broader memory
   baselines beyond S1 still need to be collected.
