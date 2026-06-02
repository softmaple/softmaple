---
title: Architecture Overview
description: Collaboration architecture boundaries for document data, awareness state, providers, and future integrations.
---

# Architecture Overview

Softmaple's collaboration architecture separates persistent document
data from ephemeral user/session awareness. These concerns often move
over the same realtime connection, but they are not the same layer and
must not own each other's merge rules.

The current collaboration packages are:

- `@softmaple/eg-walker`
- `@softmaple/awareness`

There is no `@softmaple/presence` package. Softmaple uses
`@softmaple/awareness` for user/session awareness.

This naming rule applies to the package name. "Presence" remains valid
for user-facing state, UI component names, type names, and wire events
that describe who is online and where collaborators are working.

## Boundaries at a glance

```text
                 transport only
        +-------------------------------+
        |            Provider           |
        |  WebSocket / WebRTC / storage |
        +---------------+---------------+
                        |
          carries opaque messages for:
                        |
      +-----------------+-----------------+
      |                                   |
+-----v------------------+      +---------v-------------+
| @softmaple/eg-walker   |      | @softmaple/awareness  |
| persistent document    |      | ephemeral awareness   |
| data                   |      | state                 |
+------------------------+      +-----------------------+
```

`@softmaple/eg-walker` synchronizes documents, not people.

`@softmaple/awareness` synchronizes people/session state, including
presence, not documents.

Providers transport messages. They may carry both eg-walker document
updates and awareness updates, but they must not own document merge
logic, awareness merge logic, or editor-specific behavior.

## Package roles

| Package                | Owns                                                | Does not own                                                                                                                        |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `@softmaple/eg-walker` | Persistent collaborative document data              | Awareness, user metadata, online state, cursor broadcasting, selection broadcasting, transport implementation, editor-specific APIs |
| `@softmaple/awareness` | Ephemeral user/session awareness and presence state | Persistent document convergence, eg-walker merge rules, editor-specific document APIs                                               |
| Providers              | Message transport                                   | Document merge logic, awareness merge logic, editor-specific logic                                                                  |

See [Package Responsibilities](./package-responsibilities.md) for the
full responsibility matrix.

## Dependency direction

The two core collaboration packages are siblings:

```text
@softmaple/eg-walker      @softmaple/awareness
         |                         |
         | no imports either way   |
         +-----------x-------------+
```

Required rules:

- `@softmaple/eg-walker` must not depend on
  `@softmaple/awareness`.
- `@softmaple/awareness` must not depend on
  `@softmaple/eg-walker`.
- Providers should remain transport-focused.
- Future integrations may bridge packages, but they are out of scope
  now.

The host application or a future integration is where document updates
and awareness state may be composed:

```text
                      future scope
                  +----------------+
                  | integration /  |
                  | editor binding |
                  +-------+--------+
                          |
           +--------------+--------------+
           |                             |
+----------v-------------+   +-----------v------------+
| @softmaple/eg-walker   |   | @softmaple/awareness   |
+------------------------+   +------------------------+
```

This direction keeps both core packages reusable for rich text
editors, code editors, whiteboards, canvas apps, React Flow,
spreadsheets, and multiplayer UI.

## Current scope

Current architecture scope:

- Keep `@softmaple/eg-walker` focused on persistent collaborative
  document data.
- Keep `@softmaple/awareness` focused on ephemeral user/session state,
  including presence.
- Keep providers focused on transporting opaque update messages.
- Document and enforce dependency direction.

Current docs:

- [Collaboration Architecture Layers](./collaboration-layers.md)
- [Collaboration Models](./collaboration-models.md)
- [Awareness Design](./awareness-and-presence.md)
- [Package Responsibilities](./package-responsibilities.md)
- [ADR: Collaboration Architecture Boundaries](./adr/collaboration-architecture-boundaries.md)

## Future scope

Editor bindings and adapters are deferred until concrete requirements
are clear. Do not create adapter packages or shared adapter APIs as
part of the current architecture.

Possible future integrations may include:

- `eg-walker-prosemirror`
- `eg-walker-lexical`
- `eg-walker-slate`
- `eg-walker-codemirror`
- `eg-walker-monaco`
- `awareness-eg-walker`

These names are examples of possible future integration directions,
not package commitments.
