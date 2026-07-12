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
../egwalker-paper
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
cd ../egwalker-paper/tools/bench-yjs
npm i
node bench-remote.js
```

Optional memory benchmark:

```bash
node --expose-gc bench-memusage.js
```

The remote-time benchmark writes:

```text
../egwalker-paper/results/js.json
```

The memory benchmark writes:

```text
../egwalker-paper/results/yjs_memusage.json
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
  snapshot path. `snapshotRestoreMs` is expected to avoid historical replay and
  restore enough engine state for subsequent local edits, frontier-extending
  remote edits, and bounded concurrent remote edits to continue from the
  snapshot.

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

## Patch-Level Import-Stress Conversion

The trace converter retains a programmatic patch-level import-stress mode:

```text
paper txn patch -> one delete event, one insert event, or both
```

Patch-level conversion is useful for package-level compound-event stress tests,
but it is not accepted by `paper-bench` and its output must not be reported as
paper-conformant timing, memory, or storage data. See
[Operation-Level Conversion](#operation-level-conversion).

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
  snapshot replica. `snapshotFullReplays` must stay `0` for native snapshot
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
../egwalker-paper
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

Patch-level import stress is faster, but it is not faithful enough for
paper-aligned concurrent/asynchronous measurements. In particular, a patch that
inserts a long string collapses many paper event-graph nodes into one SoftMaple
event. Later concurrent operations may depend on positions inside that inserted
run. Collapsing the run can make a later operation's parent-version index invalid
during replay.

`paper-bench` therefore always uses operation-level conversion:

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

`--max-events` stops operation expansion at the requested event instead of
materializing the rest of a large trace and slicing afterward. This keeps
bounded smoke runs bounded in both time and memory.

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

After native snapshot engine adoption and checkpoint persistence, local
benchmark data collected on 2026-06-05 with Node v24.12.0:

```text
Command: pnpm --filter @softmaple/eg-walker paper-bench -- --plan-phase0 --memory --runs 3

S1 full: native load 7.65s, snapshot decode 0.575s, snapshot restore 1.226s, snapshot 159.9MB
S2 full: native load 13.93s, snapshot decode 0.797s, snapshot restore 1.145s, snapshot 178.4MB
S3 full: native load 24.21s, snapshot decode 2.470s, snapshot restore 4.028s, snapshot 346.5MB
A1 full: native load 5.64s, snapshot decode 0.452s, snapshot restore 1.017s, snapshot 137.6MB
C1 3k: native load 0.026s, snapshot decode 0.00012s, snapshot restore 0.007s, snapshot 239KB
C1 10k: native load 0.144s, snapshot decode 0.00018s, snapshot restore 0.018s, snapshot 702KB
C2 3k: native load 0.028s, snapshot decode 0.00395s, snapshot restore 0.013s, snapshot 2.7MB
C2 10k: native load 0.146s, snapshot decode 0.00101s, snapshot restore 0.018s, snapshot 831KB

Command: pnpm --filter @softmaple/eg-walker paper-bench -- --datasets A2 --runs 3 --max-txns 300 --granularity operation --memory
A2 300 operation-level: native load 0.322s, snapshot decode 0.017s, snapshot restore 0.113s, snapshot 6.8MB
```

All of these runs reported `snapshotFullReplays=0`. This confirmed the native
snapshot path no longer paid historical replay during restore. At that point the
remaining full-paper bottleneck was snapshot materialization: sequence records
were still stored as object-shaped data in the JSON header, so S3 reached a
346MB snapshot and about 1.43GB snapshot heap delta in memory mode. Phase 6
therefore started by moving sequence/delete-target/checkpoint data into compact
binary sections instead of optimizing replay further.

After PR #788, local benchmark data collected on 2026-06-08 with Node v24.12.0:

```text
Command:
node /private/tmp/eg-walker-bench/paper-bench.js --datasets S1,S2,S3,A1 --runs 1

S1 full: snapshot decode 0.358s, snapshot restore 0.860s, snapshot 47.1MB
S2 full: snapshot decode 0.572s, snapshot restore 0.756s, snapshot 39.3MB
S3 full: snapshot decode 1.268s, snapshot restore 1.905s, snapshot 67.1MB
A1 full: snapshot decode 0.454s, snapshot restore 0.597s, snapshot 26.7MB

Command:
node /private/tmp/eg-walker-bench/paper-bench.js --datasets S1,S2,S3,A1 --runs 1 --memory

S1 full: snapshot decode 0.368s, snapshot restore 0.850s, snapshot heap 449MB, restore heap 396MB
S2 full: snapshot decode 0.564s, snapshot restore 0.780s, snapshot heap 406MB, restore heap 358MB
S3 full: snapshot decode 1.213s, snapshot restore 1.816s, snapshot heap 789MB, restore heap 700MB
A1 full: snapshot decode 0.310s, snapshot restore 0.616s, snapshot heap 310MB, restore heap 277MB
```

All of these runs reported `snapshotFullReplays=0`. PR #788 moved the
runtime-state wire format to versioned `EGWR2` bytes with id/replica string
tables, delta-varint columns, UTF-8 content blobs, and flat delete-target
refs/offsets. It also kept decoded runtime records compact until fast restore
and avoided per-character `eventItems` entries for typed-run records. The
remaining Phase 6 bottleneck is now live restore materialization: building CRDT
items and restore indexes from compact columns still costs hundreds of MB on
full-paper snapshots, especially S3.

After completing the remaining old Phase 6 split items, local benchmark data
collected on 2026-06-08 with Node v24.12.0:

```text
Command:
pnpm --filter @softmaple/eg-walker paper-bench -- --phase6-gates --memory

S1 full patch: snapshot decode 0.257s, snapshot restore 0.119s, snapshot 35.7MB, restore heap 72MB
S2 full patch: snapshot decode 0.470s, snapshot restore 0.108s, snapshot 32.6MB, restore heap 71MB
S3 full patch: snapshot decode 1.513s, snapshot restore 0.195s, snapshot 62.4MB, restore heap 135MB
A1 full patch: snapshot decode 0.157s, snapshot restore 0.103s, snapshot 24.0MB, restore heap 55MB
C1 3k patch: snapshot decode 0.0048s, snapshot restore 0.0027s, snapshot 669KB, restore heap 1.3MB
C1 10k patch: snapshot decode 0.0028s, snapshot restore 0.00013s, snapshot 311KB, restore heap 0.3MB
C2 3k patch: snapshot decode 0.0033s, snapshot restore 0.0017s, snapshot 596KB, restore heap 1.1MB
C2 10k patch: snapshot decode 0.0025s, snapshot restore 0.00011s, snapshot 284KB, restore heap 0.3MB
A2 300 operation-level: snapshot decode 0.011s, snapshot restore 0.0087s, snapshot 1.6MB, restore heap 5.4MB
```

This run exited successfully with no Phase 6 gate failure. The result changes
the next bottleneck assessment: snapshot restore is now fast for the full gate
suite, including S3. S3's remaining outlier is snapshot decode/materialization:
the 1.5s decode time and largest decode/restore heap deltas point to object
materialization and section materialization rather than replay.

After the final Phase 6 pass, local benchmark data collected on 2026-06-09 with
Node v24.12.0:

```text
Command:
pnpm --filter @softmaple/eg-walker paper-bench -- --phase6-gates --memory

S1 full patch: snapshot decode 0.258s, snapshot restore 0.116s, snapshot 35.7MB, decode heap 54MB, restore heap 72MB
S2 full patch: snapshot decode 0.478s, snapshot restore 0.107s, snapshot 32.6MB, decode heap 48MB, restore heap 71MB
S3 full patch: snapshot decode 0.788s, snapshot restore 0.191s, snapshot 62.4MB, decode heap 89MB, restore heap 135MB
A1 full patch: snapshot decode 0.166s, snapshot restore 0.087s, snapshot 24.0MB, decode heap 33MB, restore heap 55MB
C1 3k patch: snapshot decode 0.0051s, snapshot restore 0.0027s, snapshot 669KB, restore heap 1.3MB
C1 10k patch: snapshot decode 0.0028s, snapshot restore 0.00013s, snapshot 311KB, restore heap 0.3MB
C2 3k patch: snapshot decode 0.0034s, snapshot restore 0.0015s, snapshot 596KB, restore heap 1.1MB
C2 10k patch: snapshot decode 0.0025s, snapshot restore 0.00011s, snapshot 284KB, restore heap 0.1MB
A2 300 operation-level: snapshot decode 0.015s, snapshot restore 0.012s, snapshot 1.6MB, restore heap 5.4MB
```

This run exited successfully under tightened Phase 6 budgets. The final pass
removed avoidable native snapshot section copies, decodes zigzag-delta runtime
columns directly into typed arrays, keeps runtime content bytes as views, and
defers restored event indexes until a divergent edit needs retreat/advance.
Phase 6 is complete; the next optimization work should be treated as post-Phase
6 runtime profiling rather than snapshot-format completion.

The earlier 2026-06-04 raw-ingest data pointed to two different bottleneck
classes:

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
   `--max-txns`, `--max-events`, and operation-only `--granularity`.
3. `S1,S2,S3 --runs 1` has separate patch import-stress baselines.
4. `A1 --runs 1` has a separate patch import-stress baseline.
5. `C1` and `C2` pass bounded `--max-txns 3000` and `--max-txns 10000`
   patch import-stress samples.
6. `A2 --max-txns 300 --granularity operation` passes.
7. Bounded `C1`/`C2 --max-txns 3000` apply time improved from roughly
   4.4-4.5s to roughly 1.4-1.5s through checkpoint criticality and partial
   replay ordering optimizations.
8. Native snapshots restore engine resume state from compact sequence records
   and delete-target records; snapshot restore reports `snapshotFullReplays=0`.
9. Native snapshots persist retained critical checkpoints and restore them for
   bounded concurrent remote events after snapshot load.
10. The Phase 0 guardrail suite plus A2 300-txn operation smoke has current
    snapshot decode/restore/heap data from 2026-06-05.
11. PR #788 completed the main Phase 6 runtime-state wire-format work:
    `EGWR2` versioning, id/replica tables, delta-varint columns, UTF-8 content
    blobs, flat delete-target refs/offsets, lazy public compatibility getters,
    and legacy runtime-state fallback when bytes collide with the new prefix.
12. The 2026-06-08 S1/S2/S3/A1 full patch smoke has current snapshot
    decode/restore/heap data after compact runtime-state adoption.
13. The remaining old Phase 6 split items are implemented: large cold native
    snapshot header/graph sections can use `EGWC1` LZ4 wrapping, the runtime
    state path stays hot/uncompressed as `EGWR2`, and `paper-bench
--phase6-gates` codifies S1/S2/S3/A1, bounded C1/C2, and A2 operation
    smoke budgets.
14. `native-snapshot-suffix.property.test.ts` now compares compact snapshot
    restore plus random local/remote suffixes against a full replay of the
    final event graph. This caught and fixed a non-empty-initial-text case
    where snapshot runtime records were taken from a live engine whose current
    version did not match the graph frontier.
15. The 2026-06-08 full `--phase6-gates --memory` run passed. Full-trace
    restore is now about 100-200ms across S1/S2/S3/A1, bounded C1/C2 restore is
    sub-10ms, and A2 300-txn operation restore is about 9ms.
16. The final Phase 6 pass removes avoidable `Uint8Array` copies in native
    snapshot section decode, decodes zigzag-delta runtime columns directly into
    typed arrays, preserves runtime content bytes as views, and defers restored
    event indexes until divergent edits need them.
17. The 2026-06-09 tightened full `--phase6-gates --memory` run passed. S3
    snapshot decode is now about 0.79s in the main process, restore is about
    0.19s, snapshot decode heap is about 89MB, restore heap is about 135MB, and
    `snapshotFullReplays=0` across the gate suite.

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
4. Keep `--memory` in the benchmark loop for future snapshot/runtime work; S3
   decode heap and restore heap are the most useful regression signals.
