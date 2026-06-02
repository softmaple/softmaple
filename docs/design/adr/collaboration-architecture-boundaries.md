---
title: ADR - Collaboration Architecture Boundaries
description: Decision record for separating document collaboration, awareness, providers, and future integrations.
---

# ADR: Collaboration Architecture Boundaries

Status: accepted.

## Context

Softmaple has two current collaboration packages:

- `@softmaple/eg-walker`
- `@softmaple/awareness`

There is no `@softmaple/presence` package.

Document collaboration and awareness are both part of a collaborative
product experience, but they have different data lifetimes, correctness
requirements, and failure modes.

Persistent document data must converge. It is saved, replayed,
serialized, merged, and audited.

Awareness is ephemeral. It describes what users and sessions are doing
right now: cursor state, selection state, viewport state, user
metadata, and online/offline state. It can be approximate and
eventually consistent without corrupting the document.

## Decision

Softmaple separates persistent document collaboration from ephemeral
awareness.

`@softmaple/eg-walker` owns persistent collaborative document data:
document and operation models, merge/conflict resolution,
transactions, state/version vectors, update encoding/decoding, stable
anchors or relative positions where applicable, and collaborative data
structures.

`@softmaple/awareness` owns ephemeral user/session awareness:
user awareness, cursor state, selection state, viewport state, user
metadata, online/offline state, and realtime session awareness.

The package is named `@softmaple/awareness`. "Presence" remains valid
for concepts and API names that describe online users, cursors,
selections, and collaborator activity.

Providers are transport. They may carry eg-walker document updates and
awareness updates, but they must not own document merge logic,
awareness merge logic, or editor-specific logic.

Editor bindings and adapters are deferred. Do not create adapter
packages or define shared adapter APIs until concrete product and
surface requirements make the right boundary clear.

## Dependency rules

- `@softmaple/eg-walker` must not depend on
  `@softmaple/awareness`.
- `@softmaple/awareness` must not depend on
  `@softmaple/eg-walker`.
- Providers should remain transport-focused.
- Future integrations may bridge packages, but they are out of scope
  now.

## Rationale

### Document collaboration and awareness are separate concerns

Document collaboration answers: "What is the durable document state
after all accepted edits converge?"

Awareness answers: "Who is here, where are they looking or editing,
and what session state should peers see right now?"

Coupling these concerns would make document convergence depend on
low-stakes session state, and would make awareness require a document
engine even in surfaces where no eg-walker document exists.

### eg-walker focuses on persistent document data

eg-walker is responsible for durable collaboration semantics. Its
state can be serialized, replayed, diffed, merged, and tested for
convergence.

It should not own awareness, cursor broadcasting, selection
broadcasting, user metadata, online status, transport implementation,
or editor-specific APIs. Those concerns do not change document merge
correctness.

Key principle: eg-walker synchronizes documents, not people.

### awareness focuses on ephemeral session state

Awareness state is useful because it is live and low-latency, not
because it is durable. A stale cursor or missing online indicator is a
session-quality issue; it must not corrupt the document or block
document convergence.

Awareness should work for rich text editors, code editors,
whiteboards, canvas apps, React Flow, spreadsheets, and multiplayer
UI. That requires it to remain independent from eg-walker.

Key principle: `@softmaple/awareness` synchronizes people/session
state, including presence, not documents.

### awareness should not depend on eg-walker

Awareness should be usable without any document engine. A multiplayer
canvas, dashboard, spreadsheet selection layer, or whiteboard may need
cursor and user state without using eg-walker.

If awareness imported eg-walker, every awareness consumer would inherit
document-engine assumptions, bundle cost, and versioning constraints
that are irrelevant to many surfaces.

### eg-walker should not depend on awareness

eg-walker must be runnable in isolation: in tests, on a server, in a
worker, or inside another host that supplies its own awareness layer.

If eg-walker imported awareness, document convergence would become
entangled with session state and UI-adjacent concepts. That would make
the core CRDT harder to reason about and less reusable.

### Adapter and editor-binding design is deferred

Adapters and editor bindings are easy to over-design before the real
surface requirements are known. Lexical, ProseMirror, Slate,
CodeMirror, Monaco, whiteboards, and canvas tools each expose
different document models and selection semantics.

The current architecture therefore documents dependency direction and
package responsibilities, but does not introduce adapter packages,
shared adapter APIs, or speculative abstractions.

Possible future integrations may include `eg-walker-prosemirror`,
`eg-walker-lexical`, `eg-walker-slate`, `eg-walker-codemirror`,
`eg-walker-monaco`, and `awareness-eg-walker`. These are examples of
future directions, not commitments.

## Relationship to common collaboration architectures

This boundary resembles common collaboration systems:

- Yjs separates document updates from its awareness protocol.
- Liveblocks distinguishes storage/document state from live presence
  and room events.
- Automerge focuses on durable document state; user/session awareness
  is supplied by surrounding application or networking layers.
- Fluid separates shared distributed data structures from service and
  audience/session concepts.
- Figma-style collaboration treats document/object state and live
  collaborator awareness as related but distinct realtime streams.

Softmaple follows the same broad pattern: durable state and live
session state can share transport, but they should not share ownership.

## Consequences

Benefits:

- eg-walker remains a focused document-convergence package.
- awareness remains reusable across many collaborative surfaces.
- Providers can transport multiple update types without owning their
  semantics.
- Future integrations can bridge packages when requirements justify
  the boundary.

Tradeoffs:

- Hosts must compose document updates and awareness updates explicitly.
- Future editor bindings need their own decision records before they
  become package-level APIs.
- The Softmaple package boundary is `@softmaple/awareness`, but
  presence remains valid for user-facing concepts, component names,
  type names, and wire protocol names.

## Roadmap

Current scope:

- Maintain `@softmaple/eg-walker` for persistent collaborative
  document data.
- Maintain `@softmaple/awareness` for ephemeral user/session state.
- Keep providers transport-focused.
- Enforce no dependency between eg-walker and awareness.

Future scope:

- Evaluate editor bindings only after real requirements are known.
- Evaluate bridge integrations only when a host needs reusable
  composition between document updates and awareness updates.
- Add new ADRs before committing to adapter packages or shared
  adapter APIs.

Out of scope now:

- Creating adapter packages.
- Defining editor-binding APIs.
- Introducing a `@softmaple/presence` package.
- Moving document merge logic into providers.
- Moving awareness merge logic into providers.

## Related docs

- [Architecture Overview](../architecture-overview.md)
- [Package Responsibilities](../package-responsibilities.md)
- [Collaboration Architecture Layers](../collaboration-layers.md)
- [Collaboration Models](../collaboration-models.md)
- [Awareness Design](../awareness-and-presence.md)
