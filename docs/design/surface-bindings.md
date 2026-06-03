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
- The promotion rule: when a binding moves from `apps/*` into its own
  package.

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
   `delete(index, length)` for sequence; future block / object ops
   for the other models).
2. **Engine ops → surface mutations.** Apply remote events to the
   surface so the user sees the convergent state.
3. **Surface selection → awareness position.** Read the native
   selection; produce a `CursorPosition` / `SelectionRange` (or an
   opaque blob for canvas) for `@softmaple/awareness`.
4. **Awareness position → surface selection.** Restore a saved
   selection back into the surface after a remote op shifts content.
5. **Lifecycle.** Subscribe on mount, unsubscribe on unmount.

That is all a binding does. It is logical, not visual.

## What a surface binding does **not** own

A binding **MUST NOT** include any of:

- **CRDT internals.** The engine resolves conflicts; the binding
  applies the result.
- **Event graph persistence.** That belongs in the engine package.
- **Network transport.** WebSocket / WebRTC / BroadcastChannel are
  the job of a transport adapter (see below).
- **User identity.** The binding does not care who is typing, only
  what was typed.
- **Visual cursor rendering.** Remote cursors are rendered by
  `@softmaple/awareness` components (`LiveCursor`,
  `SelectionHighlight`), not by the binding.
- **Surface-specific UI components.** No React components, no CSS.
  The binding is logical glue, not a widget.

If a "binding" starts growing any of these, it is two things stuck
together. Split it.

## Bindings vs transport adapters

"Adapter" today refers to two different things in this codebase. We
keep them separate by giving them separate names:

| Concern | Name | Direction | Lives in (today) |
|---|---|---|---|
| Surface ↔ engine, surface ↔ awareness | **Surface binding** | Surface ↔ Softmaple | `apps/*`, promoted to `@softmaple/binding-<surface>` later |
| Replica ↔ replica wire transport | **Transport adapter** | Softmaple ↔ network | `@softmaple/awareness/adapters` |
| Presence state → pixels | **Presence renderer** | Awareness → DOM | `@softmaple/awareness` components |

A binding talks to **one engine** (the engine for its model) and to
awareness independently. A transport adapter knows nothing about any
surface and nothing about model internals; it moves opaque messages.

## Naming convention

- **Surface bindings**: package name `@softmaple/binding-<surface>`,
  examples: `@softmaple/binding-textarea`,
  `@softmaple/binding-codemirror`, `@softmaple/binding-lexical`,
  `@softmaple/binding-tldraw`.
- **Transport adapters**: factory function
  `create<Transport>Adapter`, already established
  (`createWebSocketAdapter`, `createBroadcastChannelAdapter`,
  `createNoopAdapter`).

When awareness's deferred `bindings/<surface>` subpath ships (issue
B2), it will follow the same surface-named convention.

## The promotion rule

A binding starts life in `apps/playground/src/surface-bindings/`
(staging area). It is promoted to a standalone
`@softmaple/binding-<surface>` package **only when** at least one of:

1. A second host (a second `apps/*` directory, or an external
   consumer) needs the same binding.
2. The binding's public surface has held stable across at least two
   refactors of the surface library it targets.
3. The binding's selection-mapping logic is reused by another
   binding via composition.

Until that bar is met, a binding stays in `apps/*`. This is
deliberate: an in-app binding is cheap to refactor; a published
package binding accrues a versioning contract. Promote on evidence,
not on aspiration.

When promotion happens, the move is mechanical:

```text
apps/playground/src/surface-bindings/codemirror/
    -> packages/binding-codemirror/src/
```

The binding's `import` from the engine (`@softmaple/eg-walker`) and
from awareness (`@softmaple/awareness`) does not change.

## Per-model binding rules

A binding is tied to one collaboration model (see
[`collaboration-models.md`](./collaboration-models.md)). The
allowable bindings per model:

- **Sequence model** — `@softmaple/eg-walker`:
  textarea, CodeMirror, Monaco, lowered Lexical / ProseMirror /
  Slate.
- **Block model** — *no engine yet*; once one exists, native
  Lexical / ProseMirror / Slate bindings bind here, not to the
  sequence engine.
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
| (future) Lexical | sequence (lowered) → block | `apps/web/` | partial, in-app |

This table is illustrative and will drift. The authoritative source
is the directory layout.
