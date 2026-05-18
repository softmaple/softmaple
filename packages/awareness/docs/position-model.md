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
- `@softmaple/eg-walker` is **not** touched. Block IDs, paths, and
  shape IDs are resolved to / from linear indices inside the awareness
  adapter or the app, never inside the CRDT runtime.

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
