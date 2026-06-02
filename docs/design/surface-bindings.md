---
title: Future Surface Integrations
description: Future-scope notes for editor and surface integrations without defining adapter APIs.
---

# Future Surface Integrations

Surface integrations are future scope. This page records the boundary
around that future work; it does not define adapter APIs, create
package names, or commit Softmaple to any editor-binding abstraction.

For the current architecture boundary, see
[`architecture-overview.md`](./architecture-overview.md),
[`package-responsibilities.md`](./package-responsibilities.md), and
the [ADR](./adr/collaboration-architecture-boundaries.md).

## Current decision

Do not create adapter packages or shared editor-binding APIs now.

The current packages remain:

- `@softmaple/eg-walker`
- `@softmaple/awareness`

There is no `@softmaple/presence` package.

## What future integrations may bridge

A future integration may compose:

- A concrete editor or collaborative surface
- `@softmaple/eg-walker` document updates
- `@softmaple/awareness` user/session awareness
- A provider that transports updates

That bridge belongs outside the two core packages until repeated
requirements show that a reusable package boundary is justified.

```text
future integration / editor binding
  +--> concrete surface
  +--> @softmaple/eg-walker
  +--> @softmaple/awareness
  +--> provider transport
```

## What future integrations must not move

Future integrations must not move these responsibilities:

- Document merge logic stays with the document engine.
- Awareness merge logic stays with `@softmaple/awareness`.
- Transport stays with providers.
- Editor-specific logic stays in the host or future integration.

## Possible future directions

Possible future integrations may include:

- `eg-walker-prosemirror`
- `eg-walker-lexical`
- `eg-walker-slate`
- `eg-walker-codemirror`
- `eg-walker-monaco`
- `awareness-eg-walker`

These are examples only. They should be introduced only when real
requirements are clear enough to justify a package and API.

## Roadmap boundary

Current scope:

- Keep `@softmaple/eg-walker` focused on persistent document data.
- Keep `@softmaple/awareness` focused on ephemeral user/session
  awareness.
- Keep providers transport-focused.
- Keep editor-specific composition in applications.

Future scope:

- Evaluate reusable editor bindings after concrete integration
  requirements are known.
- Evaluate a bridge between awareness and eg-walker only if multiple
  hosts need the same composition.
- Add a new ADR before introducing adapter packages or shared
  adapter APIs.

Out of scope now:

- New packages for editor bindings.
- Shared adapter APIs.
- Speculative abstractions for all editors or surfaces.
- A `@softmaple/presence` package.
