# @softmaple/block-model

Editor-agnostic rich-text convergence on top of `@softmaple/eg-walker`.
The package has no Lexical, React, or awareness dependency.

## Architecture

```text
  @softmaple/binding-lexical                     collab host (apps/*)
     Lexical ⇄ projection                         RichTextEventBatch
               │                                           │
         transact(fn)                             applyRemoteEvents()
               │                                           │
               └─────────────────────┬─────────────────────┘
                                     │
                               BlockReplica
                    blocks · marks · causal-LWW fields
                                     │
               ┌─────────────────────┴─────────────────────┐
               │                                           │
       escaped user text                             block markers
       one flat sequence                       event-backed ids · joins
               │                                           │
               └─────────────────────┬─────────────────────┘
                                     │
                           @softmaple/eg-walker
                   convergent sequence · stable anchors
```

The whole document — text *and* structure — lives in **one** EG-walker
sequence. Blocks are event-backed markers interleaved with escaped user text,
so a concurrent split and a concurrent insert converge under the same
algorithm rather than under a second, hand-written merge rule.

`RichTextEventBatch` is JSON-safe: a batch may be persisted or broadcast
directly, and the receiving replica needs nothing but the batch to converge.

## Usage

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
tables, and block reordering.

## Incremental state

A `BlockReplica` keeps one long-lived EG-walker replica for its whole life.
Each local or remote batch is applied to it once, and the index operations
EG-walker reports for those events update three derived structures:

- a causal index that answers ancestry for causal LWW and remove-wins rules;
- an identity-preserving mirror of the raw sequence, split into one segment per
  block marker, which resolves stable anchors and mark ranges;
- per-block metadata (fields, removals, joins, marks).

`getDocument()` rebuilds only the blocks whose segments changed, so an edit
costs the same with 50 batches of history as with 10,000. Batches with missing
dependencies stay buffered until their parents arrive.

When EG-walker has to replay concurrent history, it cannot report exact index
operations. The replica then rebuilds its sequence mirror from one full anchor
projection. It does the same when a concurrent insert lands next to a deleted
atom that an anchor still names, because only a projection knows which side of
that atom the insert took. A transaction or delivery that throws rebuilds the
state from the committed batches, so a failed update leaves no trace.
