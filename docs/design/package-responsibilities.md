---
title: Package Responsibilities
description: Responsibility and dependency rules for Softmaple collaboration packages.
---

# Package Responsibilities

This page defines the responsibilities, non-goals, and dependency
rules for Softmaple's collaboration packages.

## `@softmaple/eg-walker`

Purpose: persistent collaborative document data.

`@softmaple/eg-walker` synchronizes documents, not people.

### Responsibilities

- Document model
- Operation model
- Merge/conflict resolution
- Transactions
- State vectors / version vectors
- Update encoding / decoding
- Stable anchors / relative positions, if applicable
- Collaborative data structures

### Non-goals

- Awareness
- Cursor broadcasting
- Selection broadcasting
- User metadata
- Online status
- Transport implementation
- Editor-specific APIs

### Dependency rule

`@softmaple/eg-walker` must not depend on
`@softmaple/awareness`.

## `@softmaple/awareness`

Purpose: ephemeral user/session state.

`@softmaple/awareness` synchronizes people/session state, not
documents.

### Responsibilities

- User awareness
- Cursor state
- Selection state
- Viewport state
- User metadata
- Online/offline state
- Realtime session awareness

### Reuse targets

Awareness must remain independent from `@softmaple/eg-walker` so it
can be reused by:

- Rich text editors
- Code editors
- Whiteboards
- Canvas apps
- React Flow
- Spreadsheets
- Multiplayer UI

### Non-goals

- Persistent document merge logic
- eg-walker event graph ownership
- eg-walker version-vector ownership
- Editor-specific document APIs
- Requiring a collaborative document engine to be present

### Dependency rule

`@softmaple/awareness` must not depend on
`@softmaple/eg-walker`.

## Providers

Purpose: transport.

Provider packages may transport:

- Eg-walker document updates
- Awareness updates

Providers must not own:

- Document merge logic
- Awareness merge logic
- Editor-specific logic

Transport code may use WebSocket, WebRTC, BroadcastChannel, storage
sync, or another backend. The transport choice does not change the
responsibility split: providers move messages; the packages that own
state decide how those messages are interpreted.

## Future integrations

Future integrations may bridge `@softmaple/eg-walker` and
`@softmaple/awareness`, or bind either package to an editor surface.
That design is deferred.

Examples of possible future integrations include
`eg-walker-prosemirror`, `eg-walker-lexical`, `eg-walker-slate`,
`eg-walker-codemirror`, `eg-walker-monaco`, and
`awareness-eg-walker`.

These are possible directions only. They should not be treated as
current packages or API commitments.

## Dependency diagrams

Allowed current relationships:

```text
Provider
  | transports
  +--> eg-walker document updates
  +--> awareness updates

@softmaple/eg-walker       @softmaple/awareness
        no dependency in either direction
```

Forbidden current relationships:

```text
@softmaple/eg-walker  ----imports---->  @softmaple/awareness
@softmaple/awareness  ----imports---->  @softmaple/eg-walker
Provider              ----owns------->  merge/conflict logic
Provider              ----owns------->  editor-specific logic
```

Future-only relationship:

```text
Integration / editor binding
  +--> @softmaple/eg-walker
  +--> @softmaple/awareness

Status: deferred until real requirements are clear.
```

See [ADR: Collaboration Architecture Boundaries](./adr/collaboration-architecture-boundaries.md)
for the decision record.
