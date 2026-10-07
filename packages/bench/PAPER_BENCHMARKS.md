# Eg-walker Paper-Aligned Benchmarks

This document describes how `@softmaple/bench` measures the
`@softmaple/eg-walker` engine against the datasets and measurement style used
by the Eg-walker paper:

> Collaborative Text Editing with Eg-walker: Better, Faster, Smaller

The goal is not to reproduce the paper's Rust Diamond Types numbers inside this
TypeScript harness. The goal is to build a repeatable local benchmark that uses
the same editing traces, records the same classes of metrics, and makes the
comparison boundaries explicit.

## Reference Artifact

The paper artifact lives outside this package. From the repository root, clone
it beside the repository, where the harness looks by default, and build the
`@softmaple/eg-walker` bundle that the `node scripts/...` drivers load
(`turbo run paper-bench` builds it on its own):

```bash
git clone --depth 1 https://github.com/josephg/egwalker-paper ../egwalker-paper
pnpm install && pnpm exec turbo run build --filter=@softmaple/eg-walker
```

Pass `--paper-root` if your checkout is somewhere else.

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

On the machine in [Expected Runtime](#expected-runtime), `npm i` takes a few
seconds, `bench-remote.js` about 2.5 minutes and `bench-memusage.js` about 1.5
minutes.

### 2. SoftMaple Raw Trace Ingest

This benchmark converts the paper JSON trace into one `GraphEvent` per
keystroke and applies the events through a public receive API of
`EgWalkerReplica`: `applyCausalBatch`, `applyRemoteEvents`, or one
`applyRemoteEvent` call per event (see `--apply-api` below).

This is useful as a stress test for the `@softmaple/eg-walker` engine:

- Can it ingest paper-scale traces?
- Does it converge to the dataset's final text oracle (see
  [Final Text Oracle](#final-text-oracle))?
- Which datasets trigger slow replay paths?
- Do optimizations improve the same workload over time?

It is not a strict apples-to-apples comparison with Yjs native binary update
loading. Yjs decodes one compact binary update, while this path receives
`GraphEvent` objects, or causal batches built from them, and validates and
stores every event through the public API. JSON parsing and trace conversion
are reported separately, as `loadConvertMs`.

### 3. SoftMaple Native Payload Load

This is the fairer comparison to Yjs native update loading. The harness
converts each trace into the engine's own binary formats outside the timed
region, then times decoding and loading them:

- EGW4, the columnar event graph: `ColumnarEventGraphCodec.encodeBinary(...)`
  and `decodeBinary(...)`, then `new EgWalkerReplica(id, "", graph)`, which
  replays the history.
- EGWP1, the portable snapshot: `createPortableSnapshot()`,
  `PortableSnapshotCodec` and `EgWalkerReplica.fromPortableSnapshot(...)`.
- EGWS1, the native snapshot: `createNativeSnapshot()`, `NativeSnapshotCodec`
  and `EgWalkerReplica.fromNativeSnapshot(...)`.

JSON `serialize()` is not a native payload: it is a debugging and interop
format, far larger than EGW4 (see
[JSON serialize() Payloads](#json-serialize-payloads)).

The persistence lane records this mode in three forms:

- `nativeDecodeMs` / `nativeLoadMs`: the EGW4 columnar graph path followed
  by `new EgWalkerReplica(..., decodedGraph)`, which still replays history.
- `portableSnapshotEncodeMs` / `portableSnapshotDecodeMs` /
  `portableSnapshotRestoreMs` / `portableSnapshotMaterializeMs`: the `EGWP1`
  portable path. Restore constructs the lazy persisted representation;
  materialization explicitly loads the event graph so the two costs are not
  conflated.
- `nativeSnapshotEncodeMs` / `nativeSnapshotDecodeMs` /
  `nativeSnapshotRestoreMs`: the optional `EGWS1` resume-state extension. It
  includes already-available runtime CRDT state and retained checkpoints, but
  does not rebuild missing state during the timed encode. It is reported
  separately from paper-style portable persistence.

## JSON `serialize()` Payloads

`EgWalkerReplica.serialize()` and `EventGraph.serialize()` produce JSON with
one object per event: its ID, its parents' IDs, its operation and its
timestamp. JSON is a format for debugging, tests and interop on small
documents. Persist documents as portable snapshots, which hold the graph as
EGW4.

The persistence lane reports the JSON's UTF-8 size as `jsonBytes`, next to
EGW4 (`binaryBytes`) and the portable snapshot (`portableSnapshotBytes`), for
a replica that received the whole trace. Measured 2026-10-07 at `c48dda6`:

| Dataset |    Events |     JSON | Bytes per event | EGW4 bytes | JSON / EGW4 | Portable snapshot bytes |
| ------- | --------: | -------: | --------------: | ---------: | ----------: | ----------------------: |
| S1      |   779,334 | 151.7 MB |             195 |    335,592 |        452× |                 662,561 |
| S2      | 1,104,627 | 215.3 MB |             195 |    476,374 |        452× |                 649,088 |
| S3      | 2,339,471 | 458.9 MB |             196 |    762,910 |        601× |                 888,135 |
| C1      |   651,950 | 128.6 MB |             197 |    595,877 |        216× |               1,133,314 |
| C2      |   608,150 | 122.0 MB |             201 |    795,861 |        153× |               1,328,873 |
| A1      |   947,337 | 179.9 MB |             190 |    353,145 |        509× |                 392,901 |
| A2      |   697,638 | 131.9 MB |             189 |    336,610 |        392× |                 575,962 |

The EGW4 column encodes the graph in the order snapshots use: 1.01–1.06× the
size of Diamond Types' `.dt` files on the S and A traces and 1.18–1.28× on C,
where trace order takes 1.33–1.37× (see [Cold load](#cold-load)).

Every event repeats its own ID and its parents' IDs in full, here 40-odd
characters such as `paper:S1:agent:number:0000000000000000:41`, so JSON takes
about 190–200 bytes per keystroke; shorter replica IDs shrink it, but not by
orders of magnitude. S3's JSON is 85% of the longest string V8 can build
(2^29 − 24 UTF-16 code units, 512 MiB), so `JSON.stringify` would throw on a
history about a sixth longer.

The persistence lane builds this JSON, and the objects behind it, for every
dataset. On the machine in [Expected Runtime](#expected-runtime) it peaks at
6.2 GiB of RSS on S3, or 9.8 GiB with `--memory`, whose worker rebuilds the
binary payloads beside the main process; the other lanes stay within 2 GiB.
For timing and memory on large traces, use `--apply-only` and
`--native-only`.

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

The benchmark package script is:

```json
{
  "scripts": {
    "paper-bench": "node scripts/run-paper-bench.mjs"
  }
}
```

Run it from the repository root. Every lane replays each dataset in full
unless `--max-txns` or `--max-events` bounds it, and a full run of all seven
datasets takes minutes; [Expected Runtime](#expected-runtime) lists each
lane's wall time.

The default lane measures persistence: it receives the trace through
`applyRemoteEvents` and records the size of the replica's JSON `serialize()`
output, then encodes the replica as EGW4, a portable snapshot and a native
snapshot and loads each of them back. One run of all seven datasets takes
about 4.5 minutes:

```bash
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- --datasets S1 --runs 1
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- --datasets S1,S2,S3 --runs 1
```

Use the isolated apply lane when measuring public remote-receive throughput:

```bash
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- \
  --datasets S1,C1 \
  --runs 3 \
  --apply-batch-events all \
  --apply-only
```

`--apply-only` validates the final document and reports conversion, apply,
replay, and structural-operation metrics, but deliberately skips JSON, EGW4,
portable-snapshot, and native-snapshot construction. Keeping those phases out
of the process prevents persistence object graphs from contaminating raw apply
time and peak memory. Use the normal or `--native-only` lanes for persistence
and cold-load measurements.

`--apply-api` selects the receive API: `causal` (`applyCausalBatch`, the
default), `detailed` (`applyRemoteEvents`), or `single`, one
`applyRemoteEvent` call per event, the steady-state path of a live replica.
`single` ignores `--apply-batch-events`. Every apply line reports
`applyUsPerEvent` next to `applyMs`. The batch lanes also time each receive
call and report the distribution as `batchP50Ms`, `batchP95Ms` and
`batchMaxMs` (nearest-rank over the run's `applyCalls`); the summary line
reports their medians over runs. `single` reports `none`: timing every call
would add two clock reads per event to the lane it measures. To measure
steady-state receive latency over the first 100k events:

```bash
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- \
  --datasets S3,C1,A1 \
  --runs 3 \
  --apply-api single \
  --max-events 100000 \
  --apply-only
```

A bounded run has no dataset oracle. A bounded `detailed` or `single` run is
instead checked, after the timed region, against `applyCausalBatch` replaying
the same events, and reports `finalTextOracle=causalBatch`.

Add `--memory` to measure what an ingesting replica retains. After each timed
run, a separate `node --expose-gc` worker applies the same batches untimed,
validates the text, releases the trace and batches, and prints a
`paper-bench-apply-memory` line:

- `heapAfterApplyBytes`: heap used after GC once the trace and batches are
  released, with the replica still alive. It includes the process's own
  baseline, so compare it only between builds.
- `replicaHeapBytes`: heap that dropping the replica frees.
- `replicaArrayBufferBytes`: array buffer memory, such as packed operation
  columns, that dropping the replica frees.

```bash
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- \
  --datasets S3 \
  --runs 3 \
  --apply-batch-events all \
  --apply-only \
  --memory
```

Phase 0 guardrail suite:

```bash
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- \
  --plan-phase0 \
  --runs 1
```

This runs:

- `S1`, `S2`, `S3`, and `A1` at full trace size.
- `C1` and `C2` bounded to `--max-events 3000` and `--max-events 10000`.

The C1 and C2 bounds are part of the suite's definition, not a runtime limit:
receiving a full C1 or C2 trace takes 1–5 s in every lane.

Use memory mode for a separate `node --expose-gc` worker per case:

```bash
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- \
  --plan-phase0 \
  --runs 1 \
  --memory
```

Important output fields:

- `jsonBytes`: JSON `serialize()` payload size, for reference only; see
  [JSON serialize() Payloads](#json-serialize-payloads).
- `binaryBytes`: EGW4 columnar graph payload size. This lane encodes a graph
  built from the replica's events, as snapshots do; the `--native-only` lane
  encodes the converted trace in trace order.
- `nativeDecodeMs`: EGW4 graph decode time.
- `nativeLoadMs`: old graph-backed replica load time, including replay.
- `portableSnapshotBytes`: `EGWP1` portable payload size.
- `portableSnapshotEncodeMs` / `portableSnapshotDecodeMs` /
  `portableSnapshotRestoreMs`: portable encode, byte decode, and lazy replica
  construction time.
- `portableSnapshotMaterializeMs`: explicit event-graph materialization after
  lazy portable restore. The timer triggers the restored replica's lazy source
  without retaining the caller-facing clone returned by `exportEventGraph()`.
- `nativeSnapshotBytes`: optional `EGWS1` resume-state payload size.
- `nativeSnapshotEncodeMs` / `nativeSnapshotDecodeMs` /
  `nativeSnapshotRestoreMs`: native resume-state timings.
- `nativeSnapshotFullReplays` / `nativeSnapshotPartialReplays` /
  `nativeSnapshotIncrementalApplies`: replay counters observed on the restored
  native snapshot replica. `nativeSnapshotFullReplays` must stay `0`.
- `portableSnapshot*HeapBytes` / `nativeSnapshot*HeapBytes`: separate memory
  deltas from the explicit memory worker.

The `--native-only` lane also describes the temporary CRDT state a cold replay
builds, so that a change in `nativeLoadMs` can be traced to the shape of that
state:

- `engineEvents`: events the replay engines replayed, the nonlinear part of
  the history. Linear sections replay straight into the rope and count none.
- `sequenceRecords` / `peakSequenceRecords`: live and peak records of the
  ranked sequence.
- `recordSplits`: records split in two, where an insert or delete lands inside
  a run-length record or a retreat or advance isolates part of one.
- `retreats` / `advances`: events that transitions moved. `prepareToggles`:
  the records, or segmented placeholder ranges, whose prepare state they
  changed.
- `sequenceTreeOperations`: structural operations of the ranked sequence, the
  Fugue index and segmented placeholders; `placeholderOperations` is the
  placeholder share.
- `eventsPerPeakRecord`: `engineEvents / peakSequenceRecords`. It falls as
  records fragment, for example when each keystroke keeps its own record.
- `eventsPerToggle`: `(retreats + advances) / prepareToggles`, the events a
  transition moves per record it toggles.

The summary line reports each timing's median next to its mean, minimum and
maximum (`medianNativeDecodeMs`, `medianNativeLoadMs`). Compare builds by
median.

The script defaults to the `egwalker-paper` artifact beside the repository. The
path is derived from the `packages/bench` location, so it does
not depend on the process working directory:

```text
/path/to/egwalker-paper
```

It also accepts an override:

```bash
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- \
  --datasets S1 \
  --runs 1 \
  --paper-root /path/to/egwalker-paper
```

Optional persistence memory measurement runs a second isolated process with
`node --expose-gc` and prints a `paper-bench-memory` line:

```bash
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- \
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

`A2` is the concrete case: patch-level full ingest fails at txn 289 with an
out-of-bounds insert. `paper-bench` therefore always uses operation-level
conversion; `--granularity operation` is the default and the only value it
accepts:

```bash
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- \
  --datasets A2 \
  --runs 1 \
  --granularity operation
```

Operation-level conversion emits one SoftMaple event per paper keystroke:

- a delete patch of length `n` emits `n` single-character delete events;
- an inserted string emits one insert event per character;
- each paper agent is one replica, and event IDs are
  `paper:{dataset}:agent:{agent}:{sequence}`. `{agent}` is `number:` and the
  agent's number zero-padded to 16 digits, so that string order matches
  numeric order (`string:` and the name for a named agent), and `{sequence}`
  counts that agent's events from 0;
- a transaction's child frontier is the last emitted operation in its span.

Every dataset converts and replays in full at this granularity, A2 included;
see [Expected Runtime](#expected-runtime). `--max-events` stops operation
expansion at the requested event instead of materializing the rest of a large
trace and slicing afterward, so a bounded run, for example to profile the
start of a trace, stays bounded in both time and memory.

## Final Text Oracle

Every unbounded run validates the final text after its timed region closes.
Result lines report which oracle was used as
`finalTextOracle=endContent|referenceDigest` (`none` for bounded runs, except
`causalBatch` for a bounded `detailed` or `single` apply lane; see above).

| Datasets               | Oracle            | Check                                                 |
| ---------------------- | ----------------- | ----------------------------------------------------- |
| S1, S2, S3, C1, C2, A1 | `endContent`      | exact equality with the trace's `endContent`          |
| A2                     | `referenceDigest` | UTF-16 length, then SHA-256 of the UTF-8 encoded text |

A2 cannot be validated against `endContent`. The paper builds it with
`dt bench-duplicate raw/git-makefile.dt -n2` and exports it with
`dt export-trace` (`step1-prepare.sh`), so it is git-makefile twice: 697,638 =
2 × 348,819 events. The export replaces agent names with numbers in
lexicographic order and splits some agents into several numbered slots (375
slots in A2.json, 299 agents in the raw history). Diamond Types orders
concurrent inserts at the same position by agent name, and that information
does not survive the export. The first divergence is the order of two
concurrent inserts near offset 27,800: `endContent` has
`"AM_OBJS))\n TEST_BUILTINS_OBJS"` where any faithful replay of A2.json has
`"AM_OBJS))\n\nTEST_BUILTINS_OBJS"`.

The paper's own TypeScript reference implementation
(`eg-walker-reference`) replays A2.json to exactly the same bytes as every
SoftMaple path, so A2 is validated against that result instead:

| Input                      | Value                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| egwalker-paper commit      | `4d9bef55e4f2e3b3b8b0efe8f91cd35d34ed35a8`                         |
| `datasets/A2.json` SHA-256 | `d81efb97c3316c0b8d9555f26be2fcbe57e70f36b2e5fd38256e636a747bfba0` |
| Final text length (UTF-16) | 227,352                                                            |
| Final text SHA-256 (UTF-8) | `3a4da13d6f7ead4357d1a93fec2f6cf58f7a2cbb50aef742c163caef64ed455c` |

The digests live in `src/bench/paper-final-text.ts`. The harness hashes
`A2.json` before using them and fails if the dataset changed, so a stale digest
never validates new data.

Agreement with Diamond Types on this history is still tested. The
`@softmaple/eg-walker` conformance suite (`test:conformance`) replays the raw
DT exports in `eg-walker-reference/testdata`, which keep real agent names, and
requires DT's `endContent` byte for byte: `git-makefile-raw.json` (the source
of A2), `node_nodecc-raw.json` (the source of A1) and `ff-raw.json`.

To regenerate the A2 digest (about 7 minutes):

```bash
(cd ../egwalker-paper/eg-walker-reference && npm install && npx tsc -p .)
node packages/bench/scripts/paper-reference-oracle.mjs --dataset A2
```

The script zero-pads numeric agents so their string order equals numeric
order, matching the bench converter's padded agent keys; the reference
tie-breaks concurrent inserts by agent string, so unpadded agents produce a
different document.

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
portableSnapshotEncodeMs
portableSnapshotDecodeMs
portableSnapshotRestoreMs
portableSnapshotMaterializeMs
portableSnapshotBytes
nativeSnapshotEncodeMs
nativeSnapshotDecodeMs
nativeSnapshotRestoreMs
nativeSnapshotBytes
nativeSnapshotFullReplays
nativeSnapshotPartialReplays
nativeSnapshotIncrementalApplies
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
portableSnapshotDecodeHeapBytes
portableSnapshotRestoreHeapBytes
portableSnapshotMaterializeHeapBytes
portableSnapshotHeapBytes
nativeSnapshotDecodeHeapBytes
nativeSnapshotRestoreHeapBytes
nativeSnapshotHeapBytes
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
- `replica.getText()` does not match the dataset's final text oracle for
  unbounded runs where the chosen granularity is expected to be faithful (see
  [Final Text Oracle](#final-text-oracle));
- portable snapshot round-trip or explicit materialization changes the text or
  event count;
- native snapshot restore performs a full replay;
- binary encode/decode round-trip fails once native payload measurement is
  added.

## Expected Runtime

Baselines after the second performance round (#972), measured on 2026-10-07
at `c48dda6`, on a 4 vCPU Intel Xeon (Cascade Lake, 2.8 GHz) KVM guest with
15 GB RAM, Linux and Node v22.22.0, with the paper checkout at `4d9bef5`.
Every command below ran as written, from the repository root. The `70cc242`
columns rerun the same commands, in the same session, at the commit #972
started from; on every lane both measured, they come within 0.8–1.4× of
#972's own numbers (see [History](#history)). Other machines differ by a
roughly constant factor, so compare builds on one machine, base and head in
one session.

```bash
# Receive: the whole trace as one batch, then 4,096-event batches
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- --datasets all --runs 3 --apply-only --apply-batch-events all
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- --datasets all --runs 3 --apply-only --apply-batch-events 4096

# Per-event receive
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- --datasets all --runs 3 --apply-only --apply-api single --max-events 100000

# Cold replay from a decoded EGW4 graph
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- --datasets all --runs 3 --native-only

# Open a portable snapshot, then the first edits
node packages/bench/scripts/run-snapshot-first-edit-bench.mjs --datasets S1,S2,S3,C1,C2,A1,A2 --runs 3 \
  --kinds native,local,remote,concurrent-10,concurrent-1000,native-concurrent-1000

# Memory a replica retains after receiving a whole trace
pnpm exec turbo run paper-bench --filter=@softmaple/bench -- --datasets all --runs 1 --apply-only --apply-batch-events all --memory
```

Wall time of each whole command, all seven datasets:

| Command                       | `c48dda6` | `70cc242` |
| ----------------------------- | --------: | --------: |
| Receive, whole trace          |      53 s |      99 s |
| Receive, 4,096-event batches  |      88 s |     245 s |
| Per-event receive             |      43 s |      64 s |
| Cold replay                   |     105 s |     119 s |
| Portable snapshot first edits |     191 s |         — |
| Retained memory               |      46 s |      75 s |

The receive lanes run their three runs in one process, so run 1 is cold and
runs 2 and 3 are warm; `--native-only` starts a fresh worker for every run. The
tables give the median of the three. Every run validated its final text: a
whole trace against `endContent` or A2's reference digest, a 100,000-event
prefix against `applyCausalBatch` replaying the same events.

### Receive

Time of the receive calls and the final `getText()`, in ms, or µs per event
for one `applyRemoteEvent` call per event over the first 100,000 events.
Converting the trace beforehand takes another 1–3 s per dataset, reported as
`loadConvertMs`.

| Dataset |    Events | Whole trace | `70cc242` | 4,096 / batch | `70cc242` | µs per event | `70cc242` |
| ------- | --------: | ----------: | --------: | ------------: | --------: | -----------: | --------: |
| S1      |   779,334 |         266 |       684 |           226 |       466 |          6.7 |       8.2 |
| S2      | 1,104,627 |         129 |       623 |           220 |       481 |          5.5 |       6.7 |
| S3      | 2,339,471 |         201 |     1,194 |           390 |     1,023 |          5.9 |       6.4 |
| C1      |   651,950 |       1,087 |     3,408 |         2,807 |    11,645 |         12.4 |      21.9 |
| C2      |   608,150 |         908 |     3,148 |         3,206 |    12,126 |         12.1 |      20.7 |
| A1      |   947,337 |         587 |     3,275 |         3,853 |    15,347 |          9.4 |      22.4 |
| A2      |   697,638 |         807 |     5,507 |         5,545 |    26,213 |         15.8 |      38.4 |

Receiving a whole trace as one batch takes 0.1–1.1 s on every dataset. On the
concurrent and asynchronous traces, 4,096-event batches still take 2.6–6.9×
as long as one whole-trace batch, and per-event receive costs 9–16 µs per
event.

### Cold load

`--native-only` encodes each converted trace as EGW4, in trace order, outside
the timed region, then decodes and replays it in a fresh `node --expose-gc`
worker per run, so every run is cold. Replay is `nativeLoadMs`: constructing an
`EgWalkerReplica` from the decoded graph replays the whole history. Sizes are
in bytes, times in ms.

| Dataset | DT `.dt` |    EGW4 | EGW4 / DT | Decode | Replay | `70cc242` replay |
| ------- | -------: | ------: | --------: | -----: | -----: | ---------------: |
| S1      |  316,413 | 335,592 |      1.06 |     38 |    262 |              248 |
| S2      |  471,421 | 476,374 |      1.01 |     48 |    169 |              158 |
| S3      |  729,169 | 762,910 |      1.05 |     78 |    220 |              247 |
| C1      |  466,960 | 639,559 |      1.37 |    104 |  1,163 |            2,136 |
| C2      |  676,591 | 898,934 |      1.33 |    145 |  1,157 |            2,324 |
| A1      |  334,914 | 353,094 |      1.05 |     45 |    724 |            1,437 |
| A2      |  318,046 | 337,270 |      1.06 |     50 |    785 |            2,726 |

For scale, `node bench-remote.js` (see
[Yjs Native Baseline](#1-yjs-native-baseline)) loads the same histories into
Yjs in 121–203 ms on the same machine, as means of warm iterations: S1 126,
S2 198, S3 166, C1 197, C2 121, A1 203 and A2 186 ms. Cold replay takes 0.85×
as long as Yjs on S2, 1.3–2.1× on S1 and S3, and 3.6–9.6× on the concurrent and
asynchronous traces. Diamond Types is not built here; on #972's machine its
`merge_norm` took 4.1–157 ms (see [History](#history)).

### Opening a portable snapshot

`run-snapshot-first-edit-bench.mjs` writes one EGWP1 snapshot per dataset and
then measures every lane in a fresh process per sample; see
[Snapshot first-edit latency](./README.md#snapshot-first-edit-latency). The
rows for both commits come from one run of the command above with an `--impl`
for each build, which alternates them on the same snapshot bytes. The
`prepare()` rows come from the same driver with
`--kinds prepared-local,trusted-local`. Medians of 3:

| Scenario                                                    |          S1 |          S2 |          S3 |           C1 |           C2 |           A1 |            A2 |
| ----------------------------------------------------------- | ----------: | ----------: | ----------: | -----------: | -----------: | -----------: | ------------: |
| Decode, then `fromPortableSnapshot`                         |      6.8 ms |      4.5 ms |      4.3 ms |      10.9 ms |      11.5 ms |       1.7 ms |        5.4 ms |
| First local edit, without `prepare()`                       |      313 ms |      242 ms |      350 ms |       1.36 s |       1.39 s |       815 ms |        1.07 s |
| `70cc242`                                                   |      304 ms |      219 ms |      344 ms |       2.26 s |       2.50 s |       1.88 s |        4.34 s |
| `prepare()`                                                 |      322 ms |      249 ms |      373 ms |       1.40 s |       1.38 s |       861 ms |        1.09 s |
| Longest task while preparing                                |       19 ms |       25 ms |       46 ms |        43 ms |        64 ms |        30 ms |         62 ms |
| `prepare()` of a trusted snapshot                           |       49 ms |       57 ms |       88 ms |       130 ms |       183 ms |        48 ms |         48 ms |
| First edit concurrent at depth 1,000, without `prepare()`   |      340 ms |      230 ms |      356 ms |       1.48 s |       1.35 s |       823 ms |        1.67 s |
| `70cc242`                                                   |      342 ms |      242 ms |      379 ms |       2.45 s |       2.40 s |       1.95 s |       10.94 s |
| Edit concurrent at depth 1,000 after a cold load, 1st / 2nd | 17 / 3.4 ms | 11 / 4.5 ms | 13 / 4.9 ms | 8.5 / 1.4 ms | 9.1 / 1.9 ms | 8.6 / 1.4 ms |  654 / 3.8 ms |
| `70cc242`                                                   | 35 / 7.6 ms | 34 / 7.4 ms | 29 / 5.0 ms |  30 / 3.8 ms |  30 / 3.8 ms |  31 / 3.6 ms | 6.24 / 6.16 s |

Once the first edit has paid for the decode and the proof replay, a local edit
takes about 0.1 ms. After its first concurrent edit, A2 keeps the 348,820
events that edit replayed as its replay cache, 44 MiB more heap after GC than
`70cc242` keeps, so the second concurrent edit costs 3.8 ms instead of
another replay.

### Memory

With `--apply-only`, `--memory` applies each trace again in a separate
`node --expose-gc` worker and reports what dropping the replica frees after
GC: `replicaHeapBytes` plus `replicaArrayBufferBytes`.

| Dataset | Retained | Bytes per event | `70cc242` |
| ------- | -------: | --------------: | --------: |
| S1      |   2.2 MB |             2.8 |   14.7 MB |
| S2      |   3.8 MB |             3.4 |   21.1 MB |
| S3      |   5.1 MB |             2.2 |   43.3 MB |
| C1      |  11.9 MB |            18.2 |   39.6 MB |
| C2      |  16.2 MB |            26.7 |   46.3 MB |
| A1      |   3.8 MB |             4.1 |   28.9 MB |
| A2      |   2.3 MB |             3.3 |   28.1 MB |

At `70cc242`, every C and A replica held exactly 25 MiB of array buffers, and
the S replicas 13–40 MB.

### Phase 6 gates

`--phase6-gates` thresholds were calibrated on 2026-07-12 with Node v24.12.0
on an Apple M1 from three S1 operation runs at 1,000, 2,000, and 4,000 events.
They constrain portable bytes, encode, decode, lazy restore, explicit
materialization, and heap. `--phase6-gates` and `--phase6-gates --memory` both
pass on the machine above. Full S1/S2/S3/A1 operation traces are intentionally
not gated yet: their 779k-2.34m atomic-event workloads need separate
fixed-machine baselines, and the historical patch/native numbers under
[History](#history) are not valid thresholds for them.

### History

The results below are kept as recorded. Their command strings are preserved
as run, so some name scripts or paths that no longer exist. Bare `snapshot*`
names in them refer to the native `EGWS1` resume-state extension, not the
portable `EGWP1` format. Most of the June 2026 results use patch-level
conversion, which collapses each inserted string into one event; they are not
comparable with the keystroke-granularity baselines above.

#### 2026-10-01: start of the second performance round (`70cc242`, #972)

Analysis A of #972 measured `70cc242` on a 4 vCPU Intel Xeon (2.1 GHz) Linux
VM with 15 GB RAM, Node v22.22.0 and rustc 1.97. Cold merge of the full
history, median ms:

| Dataset |    Events | DT `merge_norm` | Yjs `applyUpdateV2` | Decode | Replay | `applyCausalBatch`, whole trace | `applyCausalBatch`, 4,096 / batch |
| ------- | --------: | --------------: | ------------------: | -----: | -----: | ------------------------------: | --------------------------------: |
| S1      |   779,334 |             4.1 |                  93 |     36 |    204 |                             506 |                               477 |
| S2      | 1,104,627 |             6.2 |                 144 |     45 |    118 |                             448 |                               523 |
| S3      | 2,339,471 |             7.9 |                 125 |     80 |    189 |                           1,208 |                             1,253 |
| C1      |   651,950 |             113 |                 143 |     82 |  1,813 |                           3,336 |                            10,626 |
| C2      |   608,150 |             157 |                 101 |    106 |  1,982 |                           3,469 |                            11,934 |
| A1      |   947,337 |            18.2 |                 153 |     42 |  1,186 |                           3,218 |                            13,051 |
| A2      |   697,638 |            53.0 |                 128 |     39 |  2,205 |                           3,996 |                            18,904 |

DT (built from the paper's `tools/diamond-types`, run under `taskset 0x1`) and
Yjs are warm medians. SoftMaple decode and replay of an EGW4 graph are warm
medians of 5 iterations per process; `applyCausalBatch` is one cold run per
process, 3–5 processes.

| Scenario                                                    |          S1 |          C1 |          C2 |          A1 |            A2 |
| ----------------------------------------------------------- | ----------: | ----------: | ----------: | ----------: | ------------: |
| 4,096-event batches vs whole trace                          |       0.94× |       3.19× |       3.44× |       4.06× |         4.73× |
| `applyRemoteEvent`, µs per event (first 100k events)        |         9.2 |        24.2 |        24.5 |        24.5 |          33.9 |
| First local edit after `fromPortableSnapshot`               |      249 ms |      2.03 s |      2.20 s |      1.53 s |        3.12 s |
| Concurrent edit at depth 1,000 after a cold load, 1st / 2nd | 27 / 7.5 ms | 26 / 2.6 ms | 38 / 3.4 ms | 28 / 2.8 ms | 4.73 / 4.71 s |
| Retained memory after a whole-trace receive                 |     14.7 MB |     39.6 MB |     46.3 MB |     28.9 MB |       28.1 MB |

Analysis B of #972, on an Apple M1 with Node v24.12.0, measured times 1.6–2.4×
lower than Analysis A.

#### June 2026: patch-level ingest and Phase 6 snapshots (Apple M1, Node v24.12.0)

Undated patch-level raw-ingest baseline, recorded with the 2026-06-04 results:

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

The same optimized path then made bounded 10k concurrent samples practical as
smoke checks:

```text
Command: pnpm paper-bench -- --datasets C1,C2 --runs 1 --max-txns 10000
C1 max-txns 10000: total 16.37s, apply 16.27s, native load 0.244s
C2 max-txns 10000: total 14.85s, apply 14.76s, native load 0.223s
```

At keystroke granularity, a bounded `A2` sample of 300 txns / 46,540 events
took about 11 seconds then, 600 txns / 95,257 events about 130 seconds, and a
`--max-events 100000` probe was stopped after two minutes. The whole of A2,
697,638 events, now receives in under a second; see
[Expected Runtime](#expected-runtime).

## Reporting Guidance

Use this wording in reports:

- "SoftMaple raw ingest" for trace conversion plus a public receive API. Name
  the API (`applyCausalBatch`, `applyRemoteEvents` or `applyRemoteEvent`) and
  the batch size.
- "SoftMaple native load" for EGW4 decode plus the replica's cold replay.
- "SoftMaple portable snapshot restore" for EGWP1 decode plus
  `fromPortableSnapshot(...)` alone. Restore defers decoding the history and
  the proof replay, so a time to a replica ready to edit must also include
  `prepare()` or the first edit, as `readyToEditMs` in
  `run-snapshot-first-edit-bench.mjs` does.
- "SoftMaple native snapshot restore" for EGWS1 decode plus
  `fromNativeSnapshot(...)`, reported separately; it too leaves the graph
  encoded until something reads it.
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
   `--max-txns`, `--max-events`, `--apply-only`, and operation-only
   `--granularity`.
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
10. The Phase 0 guardrail suite plus A2 300-txn operation smoke recorded
    snapshot decode/restore/heap data on 2026-06-05.
11. PR #788 completed the main Phase 6 runtime-state wire-format work:
    `EGWR2` versioning, id/replica tables, delta-varint columns, UTF-8 content
    blobs, flat delete-target refs/offsets, lazy public compatibility getters,
    and legacy runtime-state fallback when bytes collide with the new prefix.
12. The 2026-06-08 S1/S2/S3/A1 full patch smoke recorded snapshot
    decode/restore/heap data after compact runtime-state adoption.
13. The remaining old Phase 6 split items are implemented: large cold native
    snapshot header/graph sections can use `EGWC1` LZ4 wrapping, the runtime
    state path stays hot/uncompressed as `EGWR2`. Its historical patch/native
    gate numbers are retained under [History](#history) only as dated
    results, not reused for portable operation workloads.
14. `native-snapshot-suffix.property.test.ts` now compares compact snapshot
    restore plus random local/remote suffixes against a full replay of the
    final event graph. This caught and fixed a non-empty-initial-text case
    where snapshot runtime records were taken from a live engine whose current
    version did not match the graph frontier.
15. The 2026-06-08 full `--phase6-gates --memory` run passed. Full-trace
    patch-level restore was about 100-200ms across S1/S2/S3/A1, bounded C1/C2
    restore was sub-10ms, and A2 300-txn operation restore was about 9ms.
16. The final Phase 6 pass removes avoidable `Uint8Array` copies in native
    snapshot section decode, decodes zigzag-delta runtime columns directly into
    typed arrays, preserves runtime content bytes as views, and defers restored
    event indexes until divergent edits need them.
17. The 2026-06-09 tightened full `--phase6-gates --memory` run passed. S3
    patch-level snapshot decode was about 0.79s in the main process, restore
    about 0.19s, snapshot decode heap about 89MB, restore heap about 135MB, and
    `snapshotFullReplays=0` across the gate suite.
18. Current benchmark output separates paper-style portable `EGWP1` bytes,
    decode, lazy restore, explicit materialization, and heap from optional
    native `EGWS1` resume-state metrics. Calibrated S1 1k/2k/4k operation gates
    cover every portable stage; native replay counters remain a resume-state
    regression signal. Full operation gates remain disabled until measured.
19. Every lane converts all seven datasets at keystroke granularity and can
    replay them in full, C1, C2 and A2 included, and every unbounded run
    validates its final text. [Expected Runtime](#expected-runtime) has
    2026-10-07 baselines for receive, per-event receive, cold replay,
    portable-snapshot first edits and retained memory.

Next:

1. Gate full traces. `--phase6-gates` still covers only 1k–4k-event prefixes
   of S1; the 2026-10-07 baselines are a starting point for fixed-machine
   gates on S1–A2.
2. Make the JSON `serialize()` measurement of the default persistence lane
   opt-in. It measures a debugging format, most of the lane's wall time falls
   outside its timers (one S1 run takes 34–47 s, about 5 s of it timed), and
   the lane peaks at 6.2 GiB of RSS on S3 where the other lanes stay within
   2 GiB.
3. Keep `--memory` in the benchmark loop for runtime work: the retained
   memory of the apply lane and the heap and array-buffer deltas of the
   `--native-only` lane are the most useful regression signals.

### Portable validation counters

`portableSnapshotValidationReplays`, `portableSnapshotValidationEvents` and
`portableSnapshotValidationLinearReplays` expose the validation performed
inside lazy graph materialization. The corresponding replica counters are
`snapshotValidationReplays`, `snapshotValidationEvents` and
`snapshotValidationLinearReplays`. They count successful validations performed
by that replica, separately from `fullReplays`/`partialReplays`; they are not
persisted and are not rolled back when a later edit fails. A cold copied
portable payload validates its complete history once. Exact packed chains use
the same coalesced rope replay as regular linear graph loading; concurrent
histories still use the engine. Both paths check the complete final text.
