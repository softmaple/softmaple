---
title: Collaboration Models
description: The three collaboration models Softmaple supports (sequence, block, object) and their per-engine contracts.
---

# Collaboration Models

This document defines the **collaboration models** Softmaple supports
and the per-engine contract each model implies. It is a companion to
[`collaboration-layers.md`](./collaboration-layers.md) (the legal
layering contract) and [`surface-bindings.md`](./surface-bindings.md)
(the surface-side glue).

A "collaboration model" is a tuple of three things:

1. **State shape** — what the convergent document *is*.
2. **Op shape** — what local edits and remote events look like.
3. **Position shape** — how cursors and selections are addressed.

The engines that implement these models are **siblings, not subclasses**.
There is no shared `Operation` base type and no shared engine class.
Each engine spells its model contract in its own TypeScript types;
boundaries between packages cross with structural typing rather than
shared imports (as already done for `PositionOperation` between
`@softmaple/eg-walker` and `@softmaple/awareness`).

## Why three models, not one

A single "operation" abstraction across plain text, rich text, and
canvas would be a lowest-common-denominator API: text would pay for
spatial concepts it does not need, and canvas would pay for sequence
concepts that do not fit. Keeping the models distinct lets each engine
ship the algorithm that is actually correct for its data shape.

## 1. Sequence model

The collaborative document is a **flat sequence** of code units,
graphemes, or characters. This is the model implemented today by
`@softmaple/eg-walker`.

### State shape

```ts
type SequenceState = string;
```

(Or any sequence-shaped data; the engine does not interpret the unit.)

### Op shape

```ts
type SequenceOp =
  | { type: "insert"; index: number; text: string }
  | { type: "delete"; index: number; length: number };
```

Indices are in whichever unit the caller picks (UTF-16 code units,
graphemes, UTF-32 code points). The engine does not normalise.

### Position shape

A single 1D index. When this model is exchanged with
`@softmaple/awareness`, positions take the synthetic-block form
`{ blockId: "root", offset: index }` (per the position contract in
[`collaboration-layers.md`](./collaboration-layers.md)).

### Surfaces that bind to this model

- `<textarea>` / `<input>`
- CodeMirror (single-document mode)
- Monaco
- Lexical / ProseMirror / Slate **when the document is linearised**
  (see "Lowering rich text to sequence" below)

### Engine

[`@softmaple/eg-walker`](../../packages/eg-walker/) — implements the
Eg-walker paper. Index-based public API only.

## 2. Block model

The collaborative document is a **tree of blocks**, each block
containing its own sequence (text, inline marks, etc.) or further
nested blocks. There is **no engine for this model yet**; this section
defines the slot.

### State shape (sketch)

```ts
type BlockId = string;

interface BlockTree {
  readonly root: BlockId;
  readonly blocks: ReadonlyMap<BlockId, Block>;
}

interface Block {
  readonly id: BlockId;
  readonly type: string;           // "paragraph", "heading", "list-item", …
  readonly children: readonly BlockId[];
  readonly text?: string;          // for leaf blocks with text
  readonly attrs?: Readonly<Record<string, unknown>>;
}
```

### Op shape (sketch)

```ts
type BlockOp =
  | { type: "insert-text"; blockId: BlockId; offset: number; text: string }
  | { type: "delete-text"; blockId: BlockId; offset: number; length: number }
  | { type: "split-block"; blockId: BlockId; offset: number; newId: BlockId }
  | { type: "join-blocks"; first: BlockId; second: BlockId }
  | { type: "insert-block"; parent: BlockId; index: number; block: Block }
  | { type: "remove-block"; blockId: BlockId }
  | { type: "set-attr"; blockId: BlockId; key: string; value: unknown };
```

This is illustrative. The real shape will be pinned by the first
engine implementation, not designed in the abstract.

### Position shape

`{ blockId: BlockId, offset: number }` for cursors;
`{ blockId: BlockId, from: number, to: number }` for selections.
These already exist in `@softmaple/awareness` (`CursorPosition`,
`SelectionRange`).

### Surfaces

- Lexical, ProseMirror, Slate (their native model)
- Block editors (Notion-style)
- Outliner-style apps

### Lowering rich text to sequence

It is possible to bind a Lexical / ProseMirror / Slate surface to the
**sequence** engine by linearising the document with sentinel markers
between blocks. This is a valid MVP for rich-text demos. Limitations:

- Structural ops (split, join, drag-reorder) become large
  delete/insert pairs.
- Block attributes (heading level, list type) ride along as sentinel
  text and are fragile.
- Per-block awareness mapping is harder.

Treat lowering as a stepping stone, not a destination. A native block
engine is the long-term answer for production-grade rich text.

## 3. Object model

The collaborative document is a **map of independently identified
objects**, each with its own attribute set. Canvases, whiteboards, and
node-based editors fall here. There is **no engine for this model
yet**; this section defines the slot.

### State shape (sketch)

```ts
type ObjectId = string;

interface ObjectScene {
  readonly objects: ReadonlyMap<ObjectId, SceneObject>;
  readonly zOrder: readonly ObjectId[];   // optional, fractional-indexed in practice
}

interface SceneObject {
  readonly id: ObjectId;
  readonly type: string;          // "rect", "ellipse", "arrow", "image", …
  readonly attrs: Readonly<Record<string, unknown>>;
}
```

### Op shape (sketch)

```ts
type ObjectOp =
  | { type: "create"; object: SceneObject }
  | { type: "delete"; id: ObjectId }
  | { type: "set-attr"; id: ObjectId; key: string; value: unknown }
  | { type: "reorder"; id: ObjectId; before: ObjectId | null };
```

Most attributes are **last-writer-wins registers** per field. This is
fundamentally different from sequence convergence:

- There is no canonical linear order of characters to merge.
- "Conflict" is two writers setting the same attribute, resolved by
  timestamp + tiebreaker, not by tombstoning a character.
- Reordering is sometimes a fractional index, occasionally a
  sequence-CRDT — at the *attribute* level, not the document level.

**Do not force this model through the sequence engine.** A canvas
demo that hand-rolls convergence on top of `@softmaple/awareness` + a
custom transport is an acceptable interim; promotion to a dedicated
object engine package happens only after the demo proves the ops
shape.

### Position shape

`{ x: number, y: number }` (or an arbitrary opaque blob). Canvas
positions are **not** baked into awareness's core types; they ride
through `PresenceMeta`'s open-ended `[key: string]: unknown` field,
and renderer components accept post-resolved screen coordinates
(`LiveCursorPoint`, `HighlightRect`). A canvas integration never has
to round-trip through `CursorPosition`.

### Surfaces

- tldraw, Excalidraw
- Custom whiteboard / diagram tools
- Node-based editors (React Flow style)

## Per-engine contract

Every collaboration engine — present or future — must satisfy this
informal contract. Each engine spells the types in its own package;
they are not shared.

| Method | Purpose |
|---|---|
| `apply(localOp)` | Translate a local intent into an event, advance state |
| `applyRemoteEvent(event)` | Integrate, buffer, or dedupe a remote event |
| `state()` | Read current convergent state |
| `events()` | Iterate the event graph for sync / replication |
| `subscribe(listener)` | Notify on integrated changes |

What an engine **must not** do, regardless of model:

- Depend on `@softmaple/awareness`.
- Depend on any surface framework (`lexical`, `prosemirror-*`,
  `slate*`, canvas libraries).
- Expose surface-shaped types (DOM nodes, editor selections, React
  components).

These are enforced for `@softmaple/eg-walker` today by the deny lists
in `packages/eslint-config/collaboration-layers.js` (ESLint) and
`packages/awareness/biome.jsonc` (Biome). Future engines must adopt
the same template.

## Cross-model reuse

Some plumbing genuinely *is* shared across models (event ID
generation, columnar codec for the DAG, topological order). Today
this lives inside `@softmaple/eg-walker/graph`. If and when a second
engine ships and ends up with a near-identical graph layer, extract a
shared graph package. **Not before.** Premature extraction is more
expensive than duplication for two consumers.

## Roadmap

See [`collaboration-layers.md`](./collaboration-layers.md) for the
hard rules and the project-wide roadmap. In short:

- **Now** — sequence model only (`@softmaple/eg-walker`).
- **Next** — surface bindings against the sequence model for
  textarea, CodeMirror, and a lowered Lexical demo.
- **Later** — block engine package, when a host demands real
  block-aware convergence.
- **Later still** — object engine package, after a canvas demo
  proves the ops shape on raw awareness + transport.

## When to update this doc

Update this page whenever any of the following change:

- A new collaboration model is added (or one is retired).
- An engine ships for a previously model-only slot (block / object).
- A model's position shape changes in a way that affects
  `@softmaple/awareness`'s `mapping/` subpath.
