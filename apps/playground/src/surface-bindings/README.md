# `apps/playground/src/surface-bindings/`

Staging area for **surface bindings** before they earn promotion to a
standalone `@softmaple/binding-<surface>` package.

A surface binding is the two-way translator between one user-facing
surface (textarea, CodeMirror, Lexical, canvas, …) and Softmaple's
collaboration primitives. See:

- [`docs/design/surface-bindings.md`](../../../../docs/design/surface-bindings.md)
  — the role, naming convention, and binding-vs-transport split.
- [`docs/design/collaboration-models.md`](../../../../docs/design/collaboration-models.md)
  — which engine each binding talks to.
- [`packages/awareness/docs/surface-binding-contract.md`](../../../../packages/awareness/docs/surface-binding-contract.md)
  — the TypeScript shape.

## Why bindings live here first

An in-app binding is cheap to refactor. A published package binding
accrues a versioning contract. We promote on evidence, not aspiration:
a binding moves out of this directory only when it meets the
promotion rule in
[`docs/design/surface-bindings.md`](../../../../docs/design/surface-bindings.md#the-promotion-rule).

## Layout

One subdirectory per surface, named after the surface library:

```
surface-bindings/
  codemirror/          # planned
  textarea/            # planned — existing in-app glue may migrate here
  ...
```

Each subdirectory is self-contained: types, the binding factory, and
any selection-mapping helpers specific to that surface. Bindings
import from `@softmaple/eg-walker` (sequence engine) and
`@softmaple/awareness`, and from no other surface library than their
own.

## What does **not** live here

- Transport adapters — those live in `@softmaple/awareness/adapters`.
- Presence renderers — those live in `@softmaple/awareness`.
- Engine internals — those live in `@softmaple/eg-walker` (or a
  future engine package).

## Promotion

When a binding is promoted to `@softmaple/binding-<surface>`, the
move is a straight relocation: the binding's imports from the engine
and awareness do not change. Update this README's inventory at the
same time.
