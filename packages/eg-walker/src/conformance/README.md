# Paper conformance fixtures

The paper-conformance suite intentionally keeps the author's 3.6 MB corpus
outside this repository. Prepare a pinned checkout once:

```bash
git clone https://github.com/josephg/egwalker-reference.git ~/.cache/eg-walker-reference
git -C ~/.cache/eg-walker-reference checkout 7287f4bc2c054984838b3582a27b4fea8f6d8161
```

Then run:

```bash
pnpm --filter @softmaple/eg-walker test:conformance
```

Set `EG_WALKER_REFERENCE_ROOT` when the checkout lives elsewhere. The runner
refuses any checkout whose `HEAD` is not the pinned commit or whose
`testdata/conformance.json` SHA-256 is not
`95bdb544deca513441a50ea26a1c3ecbad116061c1d0fd6dde3175ea1e0bffd7`.
It executes the full 1,000-run, 91,678-event corpus twice: once with canonical
event IDs (typed-run compression enabled) and once with non-canonical padded
IDs (typed-run compression disabled).

`paper-trace-converter.ts` is the operation-granularity adapter for paper
datasets. It replays every transaction frontier, derives Unicode-scalar to
UTF-16 offsets from the actual parent document, and rejects invalid spans or
final text. Patch-level adapters are import-stress tools and must not feed
paper performance reports.

## Baseline report fields

Release and paper-performance jobs should emit one JSON record per dataset
with the pinned source commit and fixture checksum plus:

- transaction, patch, and atomic-event counts;
- conversion, merge, load, and materialization durations;
- full, partial, and incremental replay counts;
- retreat, advance, integration-probe, and tree-operation counts;
- current and peak replay-record counts and process peak memory;
- JSON event-graph, portable columnar, and optional native-resume bytes.

Only repeated runs from the same machine and runtime are trend gates. Results
from Rust, Yjs, or other hardware are context rather than pass/fail baselines.
