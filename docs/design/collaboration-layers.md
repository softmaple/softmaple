---
title: Collaboration Architecture Layers
description: Layering boundaries between the EG-walker sequence core, block model, surface bindings, awareness, and hosts.
---

# Collaboration Architecture Layers

This document is the **source of truth** for how Softmaple's real-time
collaboration code is layered. It defines what each layer owns, what it
must not depend on, and how model bindings and awareness compose inside
`apps/*`.

The split is enforced by shared ESLint `no-restricted-imports` patterns and
awareness's equivalent Biome rule (see [Enforcement](#enforcement) below).

## Layers at a glance

```
@softmaple/eg-walker
    - convergent sequence, event graph, stable sequence anchors
                 ↓
@softmaple/block-model
    - blocks, structure, marks, rich-text event batches
        ↙                 ↘
@softmaple/binding-lexical
    - Lexical ↔ block-model projection
                            @softmaple/collab-protocol
                            - versioned wire messages and validation
        ↘                 ↙
              apps/*
    - persistence, transport, identity, UI composition

@softmaple/awareness
    - ephemeral presence, transport adapters, rendering helpers
                 ↓
              apps/*

@softmaple/collab-gateway-auth
    - server-only HMAC for the trusted web-to-collab upgrade boundary
                 ↓
              apps/web + apps/collab
```

The document path is directional: a lower model layer never imports a
higher one. Awareness remains independent from every convergent document
model and meets bindings only in the host. Concrete surface frameworks are
allowed in `@softmaple/binding-<surface>` packages and in app-local binding
staging code, but not in model or awareness packages.

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
- **Index-based base API** — operations are `insert(index, text)` /
  `delete(index, length)` against the current linear document.
- **Stable sequence anchors** — the advanced `./anchors` entry identifies
  UTF-16 atoms by insert-event ID, event offset, and affinity. It remains
  sequence-shaped and knows nothing about blocks or editor selections.

### Forbidden

`@softmaple/eg-walker` **MUST NOT**:

- Depend on `@softmaple/awareness` (no presence, no cursors, no
  transport adapters).
- Depend on `@softmaple/block-model` or any `@softmaple/binding-*`
  package; those are higher layers.
- Depend on `@softmaple/collab-protocol`; wire contracts are host-facing.
- Depend on any editor framework — `lexical`, `prosemirror-*`,
  `slate` / `slate-*`, or equivalent.
- Expose block IDs, DOM types, or editor selections. Stable sequence
  anchors are the deliberate exception to the base index-only API.

### Rationale

eg-walker is the convergence guarantee for the whole product. Keeping
it free of editor and presence concerns lets us reuse it under any
editor we choose, run it in a worker or on the server, and reason
about it in isolation when debugging divergence.

## Layer 2: `@softmaple/block-model`

The editor-agnostic rich-text document model. It is built on the stable
sequence and causal DAG supplied by EG-walker.

### Responsibilities

- **Block convergence** — stable block markers, split/join/delete semantics,
  field-level causal LWW attributes, nesting, and remove-wins deletion.
- **Inline convergence** — text, line breaks, tabs, independent inline marks,
  and structured link ranges backed by stable sequence anchors.
- **Batching and persistence boundary** — JSON-safe
  `RichTextEventBatch` values, deterministic bootstrap, remote buffering,
  deduplication, serialization, and one materialization per integrated batch.
- **Editor-independent selection positions** — stable `{ blockId, anchor }`
  endpoints and resolution back to `{ blockId, offset }`.

### Forbidden

`@softmaple/block-model` **MUST NOT**:

- Depend on `@softmaple/awareness` or any transport/presence state.
- Depend on a surface binding or editor framework.
- Depend on `@softmaple/collab-protocol`; the protocol depends on model
  batches, never the reverse.
- Expose Lexical node keys, DOM types, React components, or awareness users.

It may depend on `@softmaple/eg-walker` and its `./anchors` entry; that is
the intended direction of the model stack.

## Layer 3: `@softmaple/awareness`

The presence and cursor layer. Editor-class-agnostic.

### Responsibilities

- **Presence state** — who is online, who is in this document, status
  (`active` / `idle` / `offline`), last-seen timestamps.
- **Cursor and selection state** — keeps the legacy single-block range and
  the direction-preserving, cross-block `{ anchor, focus }` stable range as
  dependency-free JSON shapes.
- **Transport adapters** — pluggable backends (broadcast channel,
  WebSocket, no-op) under `adapters/`.
- **Rendering helpers** — primitives (`PresenceBar`, `LiveCursor`,
  `SelectionHighlight`, `ActivityIndicator`) and React hooks for the
  app shell to compose presence UI.

### Forbidden

`@softmaple/awareness` **MUST NOT**:

- Depend on `@softmaple/eg-walker`, `@softmaple/block-model`, or a
  `@softmaple/binding-*` package. Presence and convergence are independent;
  structurally mirrored JSON anchor types do not require a runtime import.
- Depend on `@softmaple/collab-protocol`; presence and durable document sync
  remain independent channels.
- Depend on any editor framework — `lexical`, `prosemirror-*`, or
  `slate` / `slate-*`.

### Rationale

Awareness is approximate by design (see
[`awareness-and-presence`](./awareness-and-presence)). It must never
gate document convergence and must never assume a particular editor.
This keeps the package safe to load in a worker, on the server (for
SSR-friendly presence snapshots), or alongside a non-Lexical editor.

## Layer 4: `@softmaple/binding-lexical`

The thin concrete surface binding. Its framework-neutral core projects
between Lexical editor state and `BlockDocument`; its separate `./react`
entry supplies lifecycle wiring with peer dependencies.

### Responsibilities

- Observe supported Lexical nodes and emit one block-model transaction per
  committed Lexical update.
- Materialize a remote `BlockDocument` in one collaboration-tagged update,
  suppress feedback, coordinate IME, and preserve stable directional
  selections.
- Fail fast on unsupported nodes or attributes.

### Forbidden

`@softmaple/binding-lexical` **MUST NOT**:

- Import `@softmaple/eg-walker` directly; the block-model API is its model
  boundary.
- Import `@softmaple/collab-protocol`; the binding owns projection, not wire
  transport.
- Own network transport, durable persistence, user identity, awareness
  state, or remote-cursor rendering.

Lexical and React imports are expected here and are peer dependencies.

## Layer 5: `@softmaple/collab-protocol`

The transport-independent wire contract shared by browser and collaboration
server hosts.

### Responsibilities

- Define versioned auth, event, repair, durable-ack, ready, and error messages.
- Parse untrusted messages into validated `RichTextEventBatch` values.
- Cap per-message batch counts and reject unsupported protocol versions.

### Forbidden

`@softmaple/collab-protocol` **MUST NOT**:

- Import EG-walker directly, a surface binding, awareness, or an editor
  framework. Rich-text payloads enter through `@softmaple/block-model`.
- Own WebSocket connections, Supabase clients, database access, JWT checks,
  React components, or any other host runtime.

## Server-only host utility: `@softmaple/collab-gateway-auth`

This package is deliberately outside the browser-safe model and wire layers.
It owns the canonical request payload, HMAC-SHA-256 signing, keyring parsing,
clock-window validation, and timing-safe signature comparison shared by
`apps/web` and `apps/collab`.

It must only run in server hosts and must not be imported by Client Components,
model packages, editor bindings, awareness, or `@softmaple/collab-protocol`.
It authenticates the gateway service, not the end user; Supabase JWT and
workspace authorization remain app-owned.

## Layer 6: `apps/*`

The integration layer. Today that is `apps/web` (Next.js + Lexical)
and `apps/playground` (CRDT experiments).

### Responsibilities

- **Binding composition** — instantiate `@softmaple/binding-lexical` with a
  `BlockReplica`, editor, room lifecycle, and error handling. App-local
  bindings for surfaces not yet promoted to packages may also live here.
- **UI composition** — wiring `@softmaple/awareness` components into
  the app shell, choosing transport adapters, theming.
- **Identity and auth** — mapping the app's user model onto
  `PresenceUser`.
- **Routing and persistence** — document IDs, room IDs, hydration from
  the database.

### Forbidden

Apps are where durable document events, ephemeral awareness, editor bindings,
identity, and UI meet. They may import the concrete editor framework for host
composition, but model and awareness logic must not be reimplemented here.

## Enforcement

The rules above are enforced mechanically by each package's existing
linter. Model and binding packages use shared ESLint pattern sets;
awareness expresses the same independence boundary in Biome:

- **`@softmaple/eg-walker`** (ESLint) — wired in via
  `packages/eg-walker/eslint.config.js`, drawing patterns from
  `egWalkerCollaborationPatterns` in
  `@softmaple/eslint-config/collaboration-layers`. Forbids
  awareness, reverse imports from block-model/binding packages, and
  editor frameworks.
- **`@softmaple/block-model`** (ESLint) — uses
  `blockModelCollaborationPatterns`. It allows EG-walker and its anchor
  entry, while forbidding awareness, binding packages, and editor
  frameworks.
- **`@softmaple/binding-lexical`** (ESLint) — uses
  `blockModelBindingCollaborationPatterns`. It allows block-model,
  Lexical, and React, while forbidding a direct EG-walker import.
- **`@softmaple/collab-protocol`** (ESLint) — uses
  `collabProtocolCollaborationPatterns`. It allows block-model wire values,
  while forbidding lower-layer bypasses, bindings, awareness, editors, and
  app-owned database/auth/server/UI runtimes.
- **`@softmaple/awareness`** (Biome) — wired in via the
  `style/noRestrictedImports` rule in `packages/awareness/biome.jsonc`.
  Forbids EG-walker, block-model, binding-lexical, and editor frameworks
  (including subpath imports).

Subpath patterns (`@lexical/*/**`, `prosemirror-*/**`, `slate-*/**`)
are spelled out explicitly in both configs because the glob `*` does
not cross `/` in either matcher; without them an import like
`@lexical/react/LexicalComposer` would slip past the rule. Biome's
`noRestrictedImports` additionally requires bare specifiers
(`@softmaple/eg-walker`, `@softmaple/block-model`,
`@softmaple/binding-lexical`, `lexical`, `slate`) to live in `paths`
rather than `patterns`, so those are listed separately in
`biome.jsonc` — the JSONC config also carries an inline comment
right above the rule restating this gotcha for the next editor.

A unit test in `packages/eslint-config` lints deliberately-bad imports
against all three ESLint pattern sets and also asserts each intended
downward import remains legal. The awareness Biome boundary test runs
the real config against generated import fixtures, including bare and
subpath forms.

If you need to add a new editor framework, extend the
module-internal `EDITOR_FRAMEWORK_PATTERNS` constant inside
`packages/eslint-config/collaboration-layers.js` (it is intentionally
not exported — there is no out-of-module consumer) **and** the matching
`style/noRestrictedImports` block in `packages/awareness/biome.jsonc`
in the same change. If a new collaboration package is introduced, add
its dependency direction to the relevant pattern set and package lint
config rather than applying one universal deny list.

## Generic position contract

The collaboration foundation must work for plain text, rich text, block,
canvas/whiteboard, node-based, and IDE-like editors. To keep model and
awareness packages surface-agnostic, positions and ranges flow through the
following shapes:

- **1D index** — for sequence editors (plain text, rich text linearised).
  Used by `@softmaple/eg-walker`'s `ExternalOperation`
  (`{ type: "insert", index, text }` / `{ type: "delete", index, length }`)
  and by `@softmaple/awareness`'s `mapping/` subpath
  (`PositionOperation`, `PositionRange`). EG-walker string indices and
  anchor offsets are UTF-16 code-unit boundaries and reject positions
  inside a surrogate pair.
- **Block-local offsets and stable endpoints** — legacy textarea presence
  keeps `{ blockId, from, to }`. Rich-text presence uses directional
  `{ anchor, focus }` endpoints, each shaped as
  `{ blockId, anchor: SequenceAnchor }`. `@softmaple/block-model`
  captures and resolves those stable endpoints without awareness or
  Lexical imports, preserving backwards and cross-block selections.
- **`{ x, y }`** (or an arbitrary opaque blob) — for canvas /
  whiteboard editors. Canvas-style positions are **not** baked into
  awareness's core types. Adapters carry them through `PresenceMeta`'s
  open-ended `[key: string]: unknown` field, and renderer components
  (`LiveCursor`, `SelectionHighlight`) already accept post-resolved
  screen coordinates (`LiveCursorPoint { x, y }`, `HighlightRect { x,
  y, width, height }`) so a canvas integration never has to round-trip
  through `CursorPosition`.

### Structural remote-event result (issue [#747](https://github.com/softmaple/softmaple/issues/747))

`EgWalkerReplica.applyRemoteEvent` returns an
`ApplyRemoteEventResult` describing the integration outcome
structurally, so consumers do not have to infer it from a `getText()`
pre/post comparison:

```ts
type ApplyRemoteEventResult =
  | { status: "integrated"; operation: PositionOperation | null }
  | { status: "buffered" }
  | { status: "duplicate" };
```

- **`"integrated"`** — the event landed in the graph and advanced the
  document. `operation` carries the engine-attributed
  `PositionOperation` when the engine took the incremental advance
  path and produced exactly one transformed op; otherwise `null`
  (visible no-op, multi-op coalesced delete, or partial/full replay).
  Consumers driving selection mapping should treat `null` as
  "remap from text diff", not "skip the remap".
- **`"buffered"`** — at least one parent is missing, the event is
  queued, and the document is unchanged. The buffered event flushes
  automatically when its last parent arrives, as a side effect of the
  parent's `applyRemoteEvent` call. That flush is **not** reported
  through a separate result — a consumer that needs per-flush
  notifications must currently re-derive them by walking the post-call
  text.
- **`"duplicate"`** — the event id is already in the graph or already
  buffered; the call is a no-op.

The `PositionOperation` shape returned from eg-walker mirrors the type
defined by `@softmaple/awareness/mapping`. Each package owns its own
copy so the layer boundary holds (eg-walker still does not depend on
awareness), and structural typing lets consumers pass either through
`mapTextareaSelectionThroughOperation` interchangeably.

#### Why this is safer than a `getText()` comparison

The pre-#747 consumer code in
`apps/playground/src/modules/collaborative-editor/use-collaborative-editor.ts`
inferred integration from a text side effect:

```ts
const before = remoteReplica.getText();
remoteReplica.applyRemoteEvent(event);
if (remoteReplica.getText() !== before) { /* assume integrated */ }
```

That works in practice but is brittle:

- It is *behavioral*, not *structural*. Any future change that lets an
  integrated event produce a zero-width visible change (a delete that
  fully overlaps already-deleted characters, an empty insert sliding
  through a coalescing path, IME compositions in #704) would silently
  flip the inferred outcome.
- It materialises the full text twice per event. The structural API
  is free on the common (incremental-advance) path; consumers that
  need a mapping op only fall back to a text diff when the engine
  returns `operation: null` (partial/full replay, multi-op coalesced
  delete, visible no-op), which is the minority case.
- It conflates "integrated" with "buffered" with "duplicate" into a
  single boolean. The new API distinguishes them so a buffered event
  cannot be mistaken for an integrated one.

#### Buffering semantics

`RemoteEventBuffer` (in `core/internals/`) still owns the same
state machine: an event with a missing parent is keyed on the
missing parent id; when that parent later arrives, every queued child
is re-tried in causal order via recursive `tryAccept` calls. The only
behavioral change is the return shape — pending/applied/duplicate
ordering, idempotence, and causal-flush semantics are preserved.

### Audit (issue [#727](https://github.com/softmaple/softmaple/issues/727))

The collaboration packages' public types were audited against the contract
above and found aligned with their assigned layer:

- `@softmaple/eg-walker` public types (`packages/eg-walker/src/types/`)
  describe a 1D sequence plus JSON-safe sequence anchors and never reference
  blocks, DOM, or any editor framework.
- `@softmaple/block-model` owns block IDs, stable block endpoints,
  `BlockDocument`, and rich-text batches, but has no Lexical, React,
  awareness, DOM, or transport types.
- `@softmaple/binding-lexical` deliberately owns Lexical projection and a
  React lifecycle entry, while its model boundary is `BlockReplica` rather
  than EG-walker internals.
- `@softmaple/awareness` public types
  (`packages/awareness/src/types/`) retain the legacy single-block range and
  add direction-preserving stable `{ anchor, focus }` endpoints by
  structurally mirroring the JSON anchor shape. Renderer components accept
  resolved screen coordinates rather than baking editor geometry into the
  presence model.

## When to update this doc

Update this page whenever any of the following change:

- A layer gains or loses a responsibility.
- The set of forbidden dependencies changes (e.g. adding a new editor
  framework or model package to the relevant deny list).
- A new top-level package joins the collaboration stack.

This doc and the ESLint rule must stay in sync. If you change one,
change the other in the same PR.
