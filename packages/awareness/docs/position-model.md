---
title: Position Model — Current and Future
description: How @softmaple/awareness models positions today, and what richer editor surfaces will require without leaking those concerns into @softmaple/eg-walker.
---

# Position Model — Current and Future

This document describes the position model used by `@softmaple/awareness`
today, why it is sufficient for the current textarea / plain-text demos,
and how it can evolve to support block editors, rich text editors,
node/path editors, canvas/whiteboard tools, and IDE-like editors —
**without** coupling `@softmaple/eg-walker` to any of those editor
classes.

It complements [`docs/design/collaboration-layers.md`](../../../docs/design/collaboration-layers.md),
which defines the package boundaries this document operates inside.

## 1. Current model: 1D index-based `PositionOperation`

Today, both `@softmaple/eg-walker` and `@softmaple/awareness` agree on a
single linear document model. Positions and ranges are integer indices
into that linear sequence.

The shapes live in
[`packages/awareness/src/mapping/position-operation.ts`](../src/mapping/position-operation.ts):

```ts
type InsertOperation = {
  readonly type: "insert";
  readonly index: number;
  readonly length: number;
};

type DeleteOperation = {
  readonly type: "delete";
  readonly index: number;
  readonly length: number;
};

type PositionOperation = InsertOperation | DeleteOperation;

type PositionRange = {
  readonly from: number;
  readonly to: number;
};
```

Cursor/selection mapping (`mapCursorThroughOperation`,
`mapSelectionThroughOperation`) and text diffing (`findChangedSpan`)
all operate over these index-based shapes. The unit of an index — UTF-16
code unit, grapheme cluster, UTF-32 code point — is decided by the
caller and applied consistently. The mapping functions themselves are
unit-agnostic.

### Why this is enough today

- **Textarea / plain-text demos** are inherently 1D. A
  `HTMLTextAreaElement` exposes `selectionStart` / `selectionEnd` as
  integer offsets into a single string.
- **`@softmaple/eg-walker` is already 1D.** Its public API is
  `insert(index, text)` / `delete(index, length)` against the current
  linear document. Awareness mirrors that shape so cursor mapping is a
  pure function of `(PositionRange, PositionOperation)`.
- **No editor framework dependency** is required. The same
  `PositionOperation` shape works for a textarea, a `contenteditable`
  treated as plain text, or a server-side replica with no DOM at all.

## 2. Why core packages must not hard-code rich-text or typesetting

Softmaple's value is convergence and presence as **reusable primitives**.
The moment `@softmaple/eg-walker` or the core of `@softmaple/awareness`
learns about blocks, marks, nodes, frames, or LaTeX, several things
break:

- **Reusability collapses.** A whiteboard app, an IDE-like surface, or a
  block editor would each force core packages to either fork or grow a
  union of unrelated concepts.
- **Convergence becomes editor-shaped.** eg-walker's correctness story
  ("identical events → identical linear document") gets tangled with
  editor-specific normalisation rules (mark merging, block coalescing,
  schema validation), making divergence bugs much harder to isolate.
- **Bundle size and surface area balloon.** Apps that only need a
  textarea would still ship typesetting types and helpers.
- **Worker / server execution gets harder.** Editor types frequently
  reach for DOM-only or framework-only APIs.

The rule that already applies to eg-walker — *index-based public API
only* — should be preserved. New position kinds belong **above**
eg-walker, in awareness adapters or in `apps/*`, never inside the CRDT
runtime.

## 3. Future editor surfaces to support

The position model needs to grow to accommodate surfaces where a single
integer is not a useful identity for "where the cursor is":

- **Block editors** (Notion-style, Lexical, BlockNote): a document is an
  ordered list of blocks, each with its own internal offset space.
  Inserting or moving a block must not invalidate cursors inside
  unrelated blocks.
- **Rich text editors** (ProseMirror, Slate, TipTap): positions are
  paths through a tree of nodes plus an offset inside a leaf.
- **Node/path-based editors** (outliners, structured form editors):
  identity is the path to a node; the "offset" may be absent.
- **Canvas / whiteboard tools** (tldraw, Excalidraw-like): there is no
  linear sequence. A "position" is a shape ID plus optionally a handle
  or a 2D point.
- **IDE-like editors** (Monaco, CodeMirror 6): positions are
  `{ line, column }` or byte offsets, and stability across edits
  matters for things like multi-cursor and gutter decorations.

A single `number` cannot represent any of these without an external
mapping table that is itself fragile under concurrent edits.

## 4. Proposed future abstractions

The intent is a discriminated union of position **kinds**, where the
current linear index becomes one variant among several. Each kind is
self-describing so mapping functions can dispatch without needing
out-of-band context.

```ts
type LinearPosition = {
  readonly kind: "linear";
  readonly index: number;
};

type BlockPosition = {
  readonly kind: "block";
  readonly blockId: string;
  readonly offset: number;
};

type PathPosition = {
  readonly kind: "path";
  readonly path: ReadonlyArray<string | number>;
  readonly offset?: number;
};
// `offset` is required when `path` resolves to a text/leaf node and the
// position lies between characters inside that leaf. It is omitted when
// `path` targets a container — in that case the position refers to the
// child element at the last path segment itself (a node-level cursor,
// not a character-level one). Mapping functions must preserve the
// omission when the target stays a container, translate or set `offset`
// when the target becomes a text node, and return `null` (a
// "not-a-position") when the target no longer has an internal offset
// space (e.g., the leaf was replaced by a void node).

type Position = LinearPosition | BlockPosition | PathPosition;

type Range = {
  readonly anchor: Position;
  readonly focus: Position;
};
```

Naming follows the existing convention in
[`position-operation.ts`](../src/mapping/position-operation.ts):
discriminator field `kind`, `readonly` everywhere, const-object +
type-alias pattern instead of TypeScript enums.

Two more kinds are likely once the corresponding adapters land, and are
listed here as anticipated rather than committed:

```ts
type CanvasPosition = {
  readonly kind: "canvas";
  readonly shapeId: string;
  readonly handle?: string;
  readonly point?: { readonly x: number; readonly y: number };
};
// A `CanvasPosition` with only `shapeId` (both `handle` and `point`
// absent) is valid and represents a *shape-level cursor*: "this user
// has the shape selected" with no sub-shape location. Consumers should
// render shape-level cursors as a selection outline / chrome on the
// shape itself, not as a caret. When a sub-shape location is needed,
// `handle` names a known anchor on the shape (e.g., `"top-left"`,
// `"end"`) and `point` carries shape-local 2D coordinates. If both are
// present, `handle` wins for hit-testing and `point` is treated as a
// hint. A future revision may tighten this to a discriminated union
// (`{ shapeId }` | `{ shapeId, handle }` | `{ shapeId, point }`) once
// adapter usage clarifies which combinations actually occur.

type LineColumnPosition = {
  readonly kind: "line-column";
  readonly line: number;
  readonly column: number;
};
```

### Operation shapes follow the same split

`PositionOperation` today is `Insert | Delete` against a single index
space. The same discriminated-union approach extends naturally:

```ts
type LinearInsert = {
  readonly type: "insert";
  readonly target: LinearPosition;
  readonly length: number;
};

type BlockInsert = {
  readonly type: "block.insert";
  readonly parent: PathPosition;
  readonly at: number;
  readonly blockId: string;
};

type BlockMove = {
  readonly type: "block.move";
  readonly blockId: string;
  readonly to: { readonly parent: PathPosition; readonly at: number };
};
```

**Type-tag naming convention.** Legacy linear operations keep their
short, unprefixed tags (`LinearInsert` → `"insert"`, `LinearDelete` →
`"delete"`) so existing callers and serialised payloads do not need to
change. Every operation kind introduced after the linear baseline uses
a dotted, namespaced tag (`BlockInsert` → `"block.insert"`, `BlockMove`
→ `"block.move"`, future `CanvasMove` → `"canvas.move"`,
`PathReplace` → `"path.replace"`, etc.) so new kinds cannot collide
with each other and stay visually grouped by editor surface.

Each new editor class contributes its own operation variants and its
own mapping function `(Range, Operation) => Range`. The existing
`mapCursorThroughOperation` and `mapSelectionThroughOperation` keep
working for the `linear` kind unchanged.

### Migration shape

- Today's `PositionOperation` becomes the `linear` variant of the wider
  union. Existing callers keep their current shape.
- New kinds are added behind their own adapter modules
  (`mapping/block-*`, `mapping/path-*`, etc.) so apps that only use
  textareas pay no bundle cost for block or path support.
- `@softmaple/eg-walker` is **not** touched. The translation between
  non-linear position kinds and the linear index space that
  `@softmaple/eg-walker` consumes happens entirely inside the
  **awareness adapter** (or in `apps/*`), never inside the CRDT
  runtime. Directionality and scope per kind:
  - **`block` (`BlockPosition`)** — bidirectional. The adapter keeps a
    `blockId → linear range` index (built on document mount, updated
    on each `BlockInsert` / `BlockMove` / `BlockDelete`). `block →
    linear` looks up the block's start and adds `offset`; `linear →
    block` does a binary search over the range index. Caveat: under
    concurrent block moves the index can be stale for one tick, so
    mappings produced mid-batch must be re-resolved after the batch
    applies.
  - **`path` (`PathPosition`)** — bidirectional but lossier. The
    adapter walks the editor's node tree on demand rather than
    maintaining a stable table, because paths invalidate on most
    structural edits. `path → linear` is well-defined when the path
    still resolves; `linear → path` requires the editor to expose a
    `linearIndex → path` query (ProseMirror's `doc.resolve`,
    Lexical's node keys). When the path no longer resolves, the
    adapter returns `null` rather than guessing a nearby node.
  - **`canvas` (`CanvasPosition`)** — **not mapped** to linear indices
    at all. Whiteboard surfaces have no linear document for
    `@softmaple/eg-walker` to converge over; canvas adapters run
    against a separate CRDT (or against eg-walker instances scoped to
    a single shape's text content). Any "canvas → linear" claim in
    future code is a bug.
  - **`line-column` (`LineColumnPosition`)** — bidirectional and
    cheap, computed on demand from a line-start table that the
    adapter rebuilds incrementally on each `LinearInsert` /
    `LinearDelete`. No stable identity beyond the current document
    snapshot.

  In all cases the mapping table (when one exists) is an adapter-local
  cache, not part of the wire format. Persisting indices across
  sessions is forbidden — they must be rebuilt from the document on
  load.

#### `PositionRange` → `Range`

The two range shapes carry different semantics and should not be
silently aliased:

- `PositionRange` is **ordered**: `from <= to` is an invariant of every
  helper that returns one (mapping, diffing). It carries no direction —
  losing the original cursor anchor is intentional, because index-based
  mapping only needs the span.
- `Range` is **directional**: `anchor` and `focus` are independent
  endpoints, `focus` is "where the caret is now", and `focus < anchor`
  is a legitimate state (a leftward selection).

To bridge them we introduce a thin alias and a one-line converter
rather than overloading `PositionRange`:

```ts
type LinearRange = {
  readonly from: LinearPosition;
  readonly to: LinearPosition;
};

// Lossy by design: drops the original caret direction, since
// `PositionRange` never carried it. Callers that know which endpoint
// is the caret should build a `Range` directly.
const positionRangeToRange = (range: PositionRange): Range => ({
  anchor: { kind: "linear", index: range.from },
  focus: { kind: "linear", index: range.to },
});

const rangeToPositionRange = (range: Range): PositionRange | null => {
  if (range.anchor.kind !== "linear" || range.focus.kind !== "linear") {
    return null;
  }
  const a = range.anchor.index;
  const f = range.focus.index;
  return { from: Math.min(a, f), to: Math.max(a, f) };
};
```

**Deprecation timeline.** `PositionRange` stays a first-class export
for the lifetime of the textarea-only API surface — it is not
deprecated by this design doc. It will only be marked `@deprecated`
once a non-linear adapter ships and at least one `apps/*` consumer has
migrated to `Range`; removal happens one minor version after that. The
`linear` kind itself is permanent.

## 5. Package boundaries

This restates [`collaboration-layers.md`](../../../docs/design/collaboration-layers.md)
specifically for the position model.

### `@softmaple/eg-walker` owns

- Document convergence.
- Event graph (DAG of inserts and deletes).
- Replay engine.
- Persistence (columnar codec, checkpoints).
- **Index-based operations only.** No block IDs, no paths, no shape
  IDs, no editor selections, no presence state.

### `@softmaple/awareness` owns

- Presence state and transport adapters.
- Cursor / selection mapping across position kinds.
- Editor bindings (textarea today; block / rich / canvas adapters in
  future).
- Rendering helpers (cursors, selection highlights, presence layer).

### `apps/*` own

- Concrete demos and product integrations.
- The choice of editor framework (Lexical, ProseMirror, Slate, Monaco,
  tldraw, …) and the glue that maps that framework's positions onto
  one of the `Position` kinds above.

## 6. Guardrail

When extending the position model, the following must remain true:

- `@softmaple/eg-walker` exposes only index-based operations. No
  awareness, cursor, selection, block, path, or rich-editor types may
  appear in its public API.
- New position kinds and their mapping functions live in
  `@softmaple/awareness` (or above), behind subpath exports so unused
  kinds tree-shake out.
- Editor-framework imports (`lexical`, `prosemirror-*`, `slate*`,
  `monaco-editor`, `tldraw`, …) stay in `apps/*` or in clearly named
  adapter packages — never in eg-walker, never in the core of
  awareness.

The ESLint `no-restricted-imports` rule in `@softmaple/eslint-config`
already enforces the eg-walker side of this boundary; new awareness
adapters should be added with the same care.
