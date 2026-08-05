# @softmaple/block-model

Editor-agnostic rich-text convergence on top of `@softmaple/eg-walker`.
The package has no Lexical, React, or awareness dependency.

```ts
import {
  BOOTSTRAP_BLOCK_ID,
  BlockReplica,
} from "@softmaple/block-model";

const local = new BlockReplica("tab-a");
const remote = new BlockReplica("tab-b");

const batch = local.transact((transaction) => {
  transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "Hello\nworld");
  transaction.setBlock(BOOTSTRAP_BLOCK_ID, { type: "h1" });
  transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 5, "bold", true);
});

if (batch) {
  // The batch is JSON-safe and may be persisted or broadcast directly.
  remote.applyRemoteEvents(JSON.parse(JSON.stringify(batch)));
}
```

`replaceDocument` is intended for thin editor bindings. New input blocks may
use transaction-local references, and the returned IDs are stable:

```ts
let stableIds: ReadonlyArray<string> = [];
local.transact((transaction) => {
  stableIds = transaction.replaceDocument({
    blocks: [
      { inputId: "title", type: "h1", text: "Outline" },
      { inputId: "parent", type: "bullet-list", text: "Parent" },
      {
        parentInputId: "parent",
        type: "check-list",
        text: "Child",
        attrs: { checked: false },
      },
    ],
  });
});
```

The sequence contains event-backed block markers and escaped user text. Field
assignments use causal LWW with event-ID tie-breaking across concurrent causal
maxima. Block deletion is remove-wins, join markers remain addressable, and
mark endpoints use stable EG-walker anchors. Bold, italic, underline, strike,
and inline-code inherit concurrent boundary inserts by default; links do not.

The v1 model intentionally omits undo/redo, arbitrary custom/decorator nodes,
tables, and block reordering. Anchor projection currently reconstructs
temporary character state from the persistent event graph for each resolution;
callers should avoid resolving large numbers of independent anchors outside a
single editor update until a batch projection API is available.
