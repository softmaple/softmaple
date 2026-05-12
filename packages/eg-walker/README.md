# @softmaple/eg-walker

Eg-walker implementation for collaborative plain-text editing, based on
["Collaborative Text Editing with Eg-walker: Better, Faster, Smaller"](https://arxiv.org/abs/2409.14252).

## Architecture

The package is organized around the paper's runtime model:

- `graph/`: persistent event graph, frontier versions, causal expansion/diff, columnar codec.
- `engine/`: temporary prepare/effect replay state, ranked B-tree index mapping, critical checkpoints, partial replay.
- `core/`: public API and thin walker coordinator.
- `types/`: public TypeScript types.

No CRDT metadata is persisted or exposed through the public API.

## Usage

```typescript
import { createEgWalkerReplica, OPERATION_TYPE } from "@softmaple/eg-walker";

const replica = createEgWalkerReplica("replica-1");

replica.applyLocalOperation({
  type: OPERATION_TYPE.INSERT,
  index: 0,
  text: "Hello, World!",
});

replica.applyLocalOperation({
  type: OPERATION_TYPE.DELETE,
  index: 7,
  length: 6,
});

console.log(replica.getText()); // "Hello, !"

const serialized = replica.serialize();
```

## Main APIs

Stable surface (`@softmaple/eg-walker`):

- `EgWalkerReplica` / `createEgWalkerReplica`: public index-based editing API.
- `ReplayWalker`: one-shot graph replay coordinator.
- `EventGraph`: persistent event DAG.
- `OPERATION_TYPE` and TypeScript types.

Internal replay primitives (`@softmaple/eg-walker/internal`, not covered by semver):

- `EgWalkerEngine`: prepare/effect replay engine.
- `ColumnarEventGraphCodec`: run-length encoded columns with varints and LZ4-compressed inserted content.
- `CriticalVersionAnalyzer`: critical checkpoint detection.
- `PartialReplayManager`: replay from checkpoint text/version.
- `IndexedSequence`: ranked B-tree backing the engine.

## Development

```bash
pnpm --filter @softmaple/eg-walker test
pnpm --filter @softmaple/eg-walker typecheck
pnpm --filter @softmaple/eg-walker build
pnpm --filter @softmaple/eg-walker lint
```

## References

- [Research paper](https://arxiv.org/abs/2409.14252)
- [Implementation guide](./IMPLEMENTATION_GUIDE.md)
