---
title: Surface Bindings
description: What a surface binding is, how it differs from a transport adapter, and when a binding graduates from apps/* to its own package.
---

# Surface Bindings

A **surface binding** is the glue between a concrete user-facing
surface (textarea, CodeMirror, Lexical, ProseMirror, Slate, canvas
tool, …) and Softmaple's collaboration primitives. Bindings are the
*only* place in the stack allowed to know about a specific surface
framework.

This doc defines:

- What a binding owns (and what it does **not** own).
- Why we use "surface" rather than "editor".
- The split between **surface bindings** and **transport adapters**.
- The promotion rule for moving app-local bindings into their own package.

For the legal layering contract, see
[`collaboration-layers.md`](./collaboration-layers.md). For the
per-binding TypeScript shape, see
[`../../packages/awareness/docs/surface-binding-contract.md`](../../packages/awareness/docs/surface-binding-contract.md).

## Why "surface", not "editor"

The term "editor adapter" was previously used. It is too narrow:

- A `<canvas>` whiteboard is not an "editor" in the textarea sense,
  but it is a collaborative surface.
- A Jupyter cell, a form field, a code-review thread, and a comment
  box are all collaborative surfaces with different bindings.
- "Surface" matches the user-facing artefact regardless of model
  (sequence / block / object — see
  [`collaboration-models.md`](./collaboration-models.md)).

The rename is mechanical; the role is unchanged from the original
"Editor Adapter Contract".

## What a surface binding owns

A binding is a **two-way translator** between a surface and Softmaple
primitives. For one surface instance, it:

1. **Local ops → engine ops.** Observe the surface's native change
   events; produce engine-shaped ops (`insert(index, text)` /
   `delete(index, length)` for sequence or a `BlockReplica` transaction
   for the block model).
2. **Engine ops → surface mutations.** Apply remote events to the
   surface so the user sees the convergent state.
3. **Surface selection → stable model position.** Read the native
   selection and produce dependency-free stable endpoints suitable for
   awareness transport.
4. **Stable model position → surface selection.** Resolve and restore a
   saved directional selection after a remote op shifts content.
5. **Lifecycle.** Subscribe on mount, unsubscribe on unmount.

That is all a binding does. It is logical, not visual.

## What a surface binding does **not** own

A binding **MUST NOT** include any of:

- **CRDT internals.** The engine resolves conflicts; the binding
  applies the result.
- **Event or batch persistence.** Serialization belongs in the model;
  choosing a database and durable-ack policy belongs in the host.
- **Network transport.** WebSocket / WebRTC / BroadcastChannel are
  the job of a transport adapter (see below).
- **User identity.** The binding does not care who is typing, only
  what was typed.
- **Visual cursor rendering.** Remote cursors are rendered by
  `@softmaple/awareness` components (`LiveCursor`,
  `SelectionHighlight`), not by the binding.
- **Surface-specific product UI.** A minimal framework lifecycle wrapper
  such as `LexicalEgWalkerPlugin` is allowed in a separate entry, but the
  binding owns no toolbar, cursor visuals, status UI, or CSS.

If a "binding" starts growing any of these, it is two things stuck
together. Split it.

## Bindings vs transport adapters

"Adapter" today refers to two different things in this codebase. We
keep them separate by giving them separate names:

| Concern | Name | Direction | Lives in (today) |
|---|---|---|---|
| Surface ↔ engine, stable selection mapping | **Surface binding** | Surface ↔ Softmaple | `@softmaple/binding-<surface>` or app-local staging |
| Replica ↔ replica wire transport | **Transport adapter** | Softmaple ↔ network | `@softmaple/awareness/adapters` |
| Presence state → pixels | **Presence renderer** | Awareness → DOM | `@softmaple/awareness` components |

A binding talks to **one model** and may expose structurally compatible
selection values for awareness without owning awareness state. A transport
adapter knows nothing about any surface and nothing about model internals; it
moves opaque messages.

## Naming convention

- **Surface bindings**: package name `@softmaple/binding-<surface>`,
  examples: `@softmaple/binding-textarea`,
  `@softmaple/binding-codemirror`, `@softmaple/binding-lexical`,
  `@softmaple/binding-tldraw`.
- **Transport adapters**: factory function
  `create<Transport>Adapter`, already established
  (`createWebSocketAdapter`, `createBroadcastChannelAdapter`,
  `createNoopAdapter`).

Awareness does not host concrete surface bindings; it consumes their
dependency-free presence shapes at the app boundary.

## The promotion rule

A binding normally starts life in `apps/playground/src/surface-bindings/`
(staging area). Promote it to a standalone `@softmaple/binding-<surface>`
package when the package boundary is part of a model's supported public
surface or when at least one of these reuse signals exists:

1. A second host (a second `apps/*` directory, or an external
   consumer) needs the same binding.
2. The binding's public surface has held stable across at least two
   refactors of the surface library it targets.
3. The binding's selection-mapping logic is reused by another
   binding via composition.

Until that bar is met, a binding stays in `apps/*`. This is
deliberate: an in-app binding is cheap to refactor; a published
package binding accrues a versioning contract. Promote on evidence,
not on aspiration. `@softmaple/binding-lexical` launched alongside the
block-model public boundary and is the current standalone example.

When promotion happens, the move is mechanical:

```text
apps/playground/src/surface-bindings/codemirror/
    -> packages/binding-codemirror/src/
```

The binding keeps importing the public engine/model for exactly one
collaboration model. It must not bypass that model to reach lower CRDT
internals; awareness remains an independent host concern.

## Per-model binding rules

A binding is tied to one collaboration model (see
[`collaboration-models.md`](./collaboration-models.md)). The
allowable bindings per model:

- **Sequence model** — `@softmaple/eg-walker`:
  textarea, CodeMirror, Monaco, lowered Lexical / ProseMirror /
  Slate.
- **Block model** — `@softmaple/block-model`; native Lexical binds here
  through `@softmaple/binding-lexical`. Future ProseMirror / Slate block
  bindings use the same model boundary.
- **Object model** — *no engine yet*; canvas / whiteboard bindings
  will bind here, never to the sequence engine via a shim.

A binding never spans models. If a single host renders two surfaces
with different models (e.g. a Lexical block surface beside a tldraw
canvas), it instantiates two bindings against two engines.

## Replaceability invariant

Any binding can be swapped for another binding against the same
engine without changes elsewhere. This is the practical test of the
layering rules in [`collaboration-layers.md`](./collaboration-layers.md):

- If swapping a textarea binding for a CodeMirror binding requires
  changes inside `@softmaple/eg-walker`, the engine has leaked
  surface concerns.
- If it requires changes inside `@softmaple/awareness`, awareness has
  leaked engine concerns.
- If it requires changes only inside the host's binding wiring, the
  layering is healthy.

## When to update this doc

Update this page whenever any of the following change:

- A new surface binding is staged in `apps/playground` (add it to
  the staging-area inventory below if we start one).
- A binding is promoted to its own package (add the package to the
  naming-convention list).
- The promotion rule itself changes.

## Current bindings (snapshot)

| Surface | Model | Lives in | Status |
|---|---|---|---|
| `<textarea>` | sequence | `apps/playground/src/modules/collaborative-editor/` | in-app |
| (future) CodeMirror | sequence | `apps/playground/src/surface-bindings/` | not yet started |
| Lexical | block | `packages/binding-lexical/` | standalone v1 binding |

This table is illustrative and will drift. The authoritative source
is the directory layout.
