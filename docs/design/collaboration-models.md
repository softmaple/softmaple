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

The models have distinct contracts, not a shared `Operation` base type or
engine class. An implementation may reuse a lower-level convergence
primitive: `@softmaple/block-model` deliberately builds its stable block and
mark semantics on EG-walker's sequence/DAG. Public model boundaries still use
their own TypeScript types rather than a universal collaboration interface.

## Why three models, not one

A single "operation" abstraction across plain text, rich text, and
canvas would be a lowest-common-denominator API: text would pay for
spatial concepts it does not need, and canvas would pay for sequence
concepts that do not fit. Keeping the models distinct lets each engine
ship the algorithm that is actually correct for its data shape.

## Abstract sequence model

In the abstract, a sequence collaboration model can operate on any ordered
unit type as long as its engine defines stable boundaries for those units.
Concrete engines must document their unit and position contract explicitly.

## 1. Sequence model

The collaborative document is a **flat UTF-16 code-unit sequence**. This is
the concrete string model implemented today by `@softmaple/eg-walker`.

### State shape

```ts
type SequenceState = string;
```

### Op shape

```ts
type SequenceOp =
  | { type: "insert"; index: number; text: string }
  | { type: "delete"; index: number; length: number };
```

The current `@softmaple/eg-walker` string API measures indices and lengths in
UTF-16 code units. Public operations and anchors reject a boundary that splits
a surrogate pair.

### Position shape

A single 1D index. When this model is exchanged with
`@softmaple/awareness`, positions take the synthetic-block form
`{ blockId: "root", offset: index }` (per the position contract in
[`collaboration-layers.md`](./collaboration-layers.md)).

### Surfaces that bind to this model

- `<textarea>` / `<input>`
- CodeMirror (single-document mode)
- Monaco
- A deliberately flattened rich-text surface with its own sequence binding

### Engine

[`@softmaple/eg-walker`](../../packages/eg-walker/) — implements the
Eg-walker paper. Its base API is index-based; `./anchors` is the advanced
stable sequence-position entry.

## 2. Block model

The collaborative document is an ordered block projection with stable IDs,
block-local text, independent inline marks, and parent IDs for nested lists.
This model is implemented by `@softmaple/block-model`.

### State shape

```ts
type BlockId = string;

interface LinkAttributes {
  readonly url: string;
  readonly target?: string;
  readonly rel?: string;
  readonly title?: string;
}

interface BlockDocument {
  readonly schemaVersion: 1;
  readonly blocks: readonly Block[];
}

interface MarkSpan {
  readonly kind:
    | "bold" | "italic" | "underline" | "strike" | "inline-code" | "link";
  readonly from: number;
  readonly to: number;
  readonly value: true | LinkAttributes;
}

interface Block {
  readonly id: BlockId;
  readonly type:
    | "paragraph" | "h1" | "h2" | "h3" | "quote" | "code"
    | "bullet-list" | "number-list" | "check-list";
  readonly text: string;
  readonly attrs: {
    readonly parentId: BlockId | null;
    readonly language: string | null;
    readonly theme: string | null;
    readonly start: number | null;
    readonly value: number | null;
    readonly checked: boolean | null;
  };
  readonly marks: readonly MarkSpan[];
}
```

The flat array is canonical document order; `parentId` supplies list nesting
without making ordering depend on recursive object traversal.

### Op shape

```ts
replica.transact((transaction) => {
  transaction.insertText(blockId, offset, text);
  transaction.deleteText(blockId, from, to);
  transaction.splitBlock(blockId, offset);
  transaction.joinBlock(blockId);
  transaction.deleteBlock(blockId);
  transaction.setBlock(blockId, fields);
  transaction.setMark(blockId, from, to, kind, value);
});
```

One transaction produces one JSON-safe `RichTextEventBatch`. Its underlying
EG events form a strict causal chain. Remote batches are buffered until their
parents are present, deduplicated, then materialized and notified atomically.

### Position shape

Resolved positions use `{ blockId, offset }`. Persisted and awareness
selection endpoints use `{ blockId, anchor: SequenceAnchor }`, preserving
direction and cross-block ranges through concurrent edits.

### Surfaces

- Lexical, ProseMirror, Slate (their native model)
- Block editors (Notion-style)
- Outliner-style apps

### Engine

[`@softmaple/block-model`](../../packages/block-model/) — uses a deterministic
event-backed bootstrap, stable raw block markers, Peritext-style anchored mark
ranges, field-level causal LWW, and remove-wins block deletion. Marker and
metadata atoms live in one EG sequence, while the public projection hides
them and exposes blocks.

This is deliberate reuse of the sequence convergence core, not a transaction
log demo: stable atom identities survive snapshots, checkpoints, deletion,
and late branches. Lexical binds to this model through
`@softmaple/binding-lexical`, not to raw EG indices.

Block drag-reordering remains outside v1.

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

Every collaboration engine — present or future — must cover this informal
contract. Exact method names remain model-specific.

| Method | Purpose |
|---|---|
| Local change entry | Translate local intent into event(s), advance state |
| Remote integration | Integrate, buffer, or dedupe remote event(s) |
| State read | Read the current convergent projection |
| Event export | Iterate events or batches for sync / replication |
| Serialization | Persist and validate a JSON-safe or binary representation |

What an engine **must not** do, regardless of model:

- Depend on `@softmaple/awareness`.
- Depend on any surface framework (`lexical`, `prosemirror-*`,
  `slate*`, canvas libraries).
- Expose surface-shaped types (DOM nodes, editor selections, React
  components).

These are enforced for both EG-walker and block-model by their package lint
configs using the role-specific deny lists in
`packages/eslint-config/collaboration-layers.js`. Future model engines must
adopt a rule matching their actual dependency direction.

## Cross-model reuse

Block-model reuses EG-walker's public replica and stable-anchor APIs instead
of copying event-ID, DAG, snapshot, or replay code. This direction is
intentional: block-model adds semantics without making EG-walker understand
blocks. A shared graph package would be justified only if a future model
cannot reuse the sequence core but needs the same DAG implementation.

## Roadmap

See [`collaboration-layers.md`](./collaboration-layers.md) for the
hard rules and the project-wide roadmap. In short:

- **Now** — sequence and block models (`@softmaple/eg-walker` and
  `@softmaple/block-model`) with the Lexical block binding.
- **Next** — harden persistence/transport and add other surface bindings
  against the appropriate existing model.
- **Later** — object engine package, after a canvas demo
  proves the ops shape on raw awareness + transport.

## When to update this doc

Update this page whenever any of the following change:

- A new collaboration model is added (or one is retired).
- An engine ships for a previously model-only slot (block / object).
- A model's position shape changes in a way that affects
  `@softmaple/awareness`'s `mapping/` subpath.
