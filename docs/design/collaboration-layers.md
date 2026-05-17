---
title: Collaboration Architecture Layers
description: Layering boundaries between @softmaple/eg-walker, @softmaple/awareness, and consumer apps.
---

# Collaboration Architecture Layers

This document is the **source of truth** for how Softmaple's real-time
collaboration code is layered. It defines what each layer owns, what it
must not depend on, and how the layers compose inside `apps/*`.

The split is enforced by an ESLint `no-restricted-imports` rule in
`@softmaple/eslint-config` (see [Enforcement](#enforcement) below).

## Layers at a glance

```
@softmaple/eg-walker
    - event graph
    - replay engine
    - convergence
    - persistence
    - index-based operations only

@softmaple/awareness
    - presence state
    - cursor/selection mapping (issue B1)
    - transport adapters
    - rendering helpers
    - editor bindings (issue B2, deferred)

apps/*
    - concrete editor integrations
    - UI composition
```

Each layer can be replaced independently. `apps/*` is the only layer
that knows about a concrete editor framework (Lexical today,
potentially ProseMirror or Slate in the future).

## Layer 1: `@softmaple/eg-walker`

The CRDT runtime. Implements the Eg-walker paper directly.

### Responsibilities

- **Event graph** — persistent DAG of inserts and deletes, columnar
  on-disk format (`graph/`).
- **Replay engine** — prepare/effect pipeline that walks the graph and
  produces the linear document state (`engine/`).
- **Convergence** — guaranteed identical state on all replicas after
  exchanging the same events.
- **Persistence** — columnar codec, critical-version checkpoints,
  topological ordering of events.
- **Index-based public API** — operations are `insert(index, text)` /
  `delete(index, length)` against the current linear document. Everything
  block-, node-, or selection-shaped is out of scope.

### Forbidden

`@softmaple/eg-walker` **MUST NOT**:

- Depend on `@softmaple/awareness` (no presence, no cursors, no
  transport adapters).
- Depend on any editor framework — `lexical`, `prosemirror-*`,
  `slate` / `slate-*`, or equivalent.
- Expose anything but index-based operations on its public API. No
  block IDs, no DOM types, no editor selections.

### Rationale

eg-walker is the convergence guarantee for the whole product. Keeping
it free of editor and presence concerns lets us reuse it under any
editor we choose, run it in a worker or on the server, and reason
about it in isolation when debugging divergence.

## Layer 2: `@softmaple/awareness`

The presence and cursor layer. Editor-class-agnostic.

### Responsibilities

- **Presence state** — who is online, who is in this document, status
  (`active` / `idle` / `offline`), last-seen timestamps.
- **Cursor and selection mapping** — translates abstract cursor /
  selection positions to and from a transport-friendly representation
  (issue B1).
- **Transport adapters** — pluggable backends (broadcast channel,
  WebSocket, no-op) under `adapters/`.
- **Rendering helpers** — primitives (`PresenceBar`, `LiveCursor`,
  `SelectionHighlight`, `ActivityIndicator`) and React hooks for the
  app shell to compose presence UI.
- **Editor bindings** — concrete glue from an editor's selection model
  to the awareness cursor model is **deferred** (issue B2). When it
  arrives it will live in a sub-path of `@softmaple/awareness` (e.g.
  `@softmaple/awareness/bindings/<editor>`) and is the only place
  inside this package allowed to know about an editor framework.

### Forbidden

`@softmaple/awareness` **MUST NOT**:

- Depend on `@softmaple/eg-walker`. Presence and convergence are
  independent concerns; awareness must work even without a CRDT
  document attached.
- Depend on any editor framework — `lexical`, `prosemirror-*`, or
  `slate` / `slate-*` — outside the deferred `bindings/<editor>`
  sub-path that does not yet exist.

### Rationale

Awareness is approximate by design (see
[`awareness-and-presence`](./awareness-and-presence)). It must never
gate document convergence and must never assume a particular editor.
This keeps the package safe to load in a worker, on the server (for
SSR-friendly presence snapshots), or alongside a non-Lexical editor.

## Layer 3: `apps/*`

The integration layer. Today that is `apps/web` (Next.js + Lexical)
and `apps/playground` (CRDT experiments).

### Responsibilities

- **Concrete editor integrations** — Lexical plugins, ProseMirror
  views, or Slate plugins that translate editor operations to and from
  eg-walker's index-based API.
- **UI composition** — wiring `@softmaple/awareness` components into
  the app shell, choosing transport adapters, theming.
- **Identity and auth** — mapping the app's user model onto
  `PresenceUser`.
- **Routing and persistence** — document IDs, room IDs, hydration from
  the database.

### Forbidden

`apps/*` is the **only** layer allowed to import a concrete editor
framework alongside `@softmaple/eg-walker` and `@softmaple/awareness`.
That is intentional: this is where the three layers meet. Any
editor-specific glue that leaks into a package is a bug.

## Enforcement

The rules above are enforced mechanically by each package's existing
linter. The two collaboration packages use different linters, so the
same intent is expressed in two formats:

- **`@softmaple/eg-walker`** (ESLint) — wired in via
  `packages/eg-walker/eslint.config.js`, drawing patterns from
  `egWalkerCollaborationPatterns` in
  `@softmaple/eslint-config/collaboration-layers`. Forbids
  `@softmaple/awareness`, `lexical`, `prosemirror-*`, and `slate` /
  `slate-*` — including subpath imports like
  `@lexical/react/LexicalComposer`.
- **`@softmaple/awareness`** (Biome) — wired in via the
  `style/noRestrictedImports` rule in `packages/awareness/biome.jsonc`.
  Forbids `@softmaple/eg-walker`, `lexical`, `prosemirror-*`, and
  `slate` / `slate-*` (including subpath imports). Biome is already the
  lint+format tool of record for this package; adding the boundary
  here avoids introducing a second linter.

Subpath patterns (`@lexical/*/**`, `prosemirror-*/**`, `slate-*/**`)
are spelled out explicitly in both configs because the glob `*` does
not cross `/` in either matcher; without them an import like
`@lexical/react/LexicalComposer` would slip past the rule. Biome's
`noRestrictedImports` additionally requires bare specifiers
(`@softmaple/eg-walker`, `lexical`, `slate`) to live in `paths`
rather than `patterns`, so those are listed separately in
`biome.jsonc` — the JSONC config also carries an inline comment
right above the rule restating this gotcha for the next editor.

A unit test in `packages/eslint-config` lints deliberately-bad imports
(including subpath specifiers) against the eg-walker config and
asserts the rule trips. The awareness Biome config is verified by
running `pnpm --filter @softmaple/awareness lint` against a fixture
import; CI catches regressions because the package's `lint` task is
already in the `turbo run lint` pipeline.

If you need to add a new editor framework, extend the
module-internal `EDITOR_FRAMEWORK_PATTERNS` constant inside
`packages/eslint-config/collaboration-layers.js` (it is intentionally
not exported — there is no out-of-module consumer) **and** the
matching `style/noRestrictedImports` block in
`packages/awareness/biome.jsonc` in the same change. The two configs
must stay in sync; the doc above describes the contract both
implement.

## Generic position contract

The collaboration foundation must work for plain text, rich text, block,
canvas/whiteboard, node-based, and IDE-like editors. To keep the two
packages editor-class agnostic, positions and ranges flow through the
following shapes:

- **1D index** — for sequence editors (plain text, rich text linearised).
  Used by `@softmaple/eg-walker`'s `ExternalOperation`
  (`{ type: "insert", index, text }` / `{ type: "delete", index, length }`)
  and by `@softmaple/awareness`'s `mapping/` subpath
  (`PositionOperation`, `PositionRange`). Indices are in whichever unit
  the caller picks (UTF-16 code units, graphemes, UTF-32 code points);
  the package does not interpret them.
- **`{ blockId, offset }`** — for block / node editors. The canonical
  cursor and selection shape in `@softmaple/awareness`
  (`CursorPosition`, `SelectionRange`). Plain-text editors use a single
  synthetic `blockId` (e.g. `"root"`); rich-text editors map one
  `blockId` per block. `selection.from` / `selection.to` are 1D offsets
  inside the addressed block.
- **`{ x, y }`** (or an arbitrary opaque blob) — for canvas /
  whiteboard editors. Canvas-style positions are **not** baked into
  awareness's core types. Adapters carry them through `PresenceMeta`'s
  open-ended `[key: string]: unknown` field, and renderer components
  (`LiveCursor`, `SelectionHighlight`) already accept post-resolved
  screen coordinates (`LiveCursorPoint { x, y }`, `HighlightRect { x,
  y, width, height }`) so a canvas integration never has to round-trip
  through `CursorPosition`.

### Audit (issue [#727](https://github.com/softmaple/softmaple/issues/727))

Both packages' public types were audited against the contract above and
found clean — no editor-class assumption has leaked in:

- `@softmaple/eg-walker` public types (`packages/eg-walker/src/types/`)
  describe index-based operations on a 1D sequence and never reference
  blocks, selections, DOM, or any editor framework.
- `@softmaple/awareness` public types
  (`packages/awareness/src/types/`) use `{ blockId, offset }` for
  cursors and `{ blockId, from, to }` for selections; `SelectionRange`
  is normalised to `min/max` at use sites rather than enforcing
  `from < to` at the type level. The `mapping/` subpath operates on
  1D indices and is explicitly scoped to sequence editors. Renderer
  components accept resolved screen coordinates (`x`, `y`, rect)
  rather than baking textarea geometry into a position type; the
  textarea-specific helpers in `utils/textarea-rects.ts` are renderer
  utilities, not part of the position contract.

## When to update this doc

Update this page whenever any of the following change:

- A layer gains or loses a responsibility (e.g. when issue B2 lands
  and editor bindings move into `@softmaple/awareness`).
- The set of forbidden dependencies changes (e.g. adding a new editor
  framework to the deny list, or graduating one to an allowed binding
  sub-path).
- A new top-level package joins the collaboration stack.

This doc and the ESLint rule must stay in sync. If you change one,
change the other in the same PR.
