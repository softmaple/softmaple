# @softmaple/awareness

Awareness primitives and UI components for realtime collaboration.

## Overview

This package provides awareness primitives and UI components designed
for low-interruption, non-blocking collaborative experiences.

Based on the design principles outlined in
[docs/design/awareness-and-presence.md](../../docs/design/awareness-and-presence.md).

## Collaboration boundary

`@softmaple/awareness` owns ephemeral user/session state. It
synchronizes people/session state, not documents.

It must remain independent from `@softmaple/eg-walker` so awareness
can be reused by rich text editors, code editors, whiteboards, canvas
apps, React Flow, spreadsheets, and multiplayer UI.

There is no `@softmaple/presence` package.

See the public docs for the full boundary:

- [Architecture Overview](../../docs/design/architecture-overview.md)
- [Package Responsibilities](../../docs/design/package-responsibilities.md)
- [ADR: Collaboration Architecture Boundaries](../../docs/design/adr/collaboration-architecture-boundaries.md)

## Features

- **PresenceBar**: Global awareness of who's online, with keyboard-focusable avatars, hover/focus tooltips, and a `loading` skeleton state for in-flight connections
- **LiveCursor**: Real-time cursor positions
- **SelectionHighlight**: Block selection indicators (multiply-blended so overlaid text stays readable)
- **ActivityIndicator**: Recent activity notifications
- **BlockActivityIndicator**: Per-block "who is editing here right now"
- **ConnectionIndicator**: Low-noise indicator that surfaces a degraded transport (hidden when healthy)
- **PresenceAvatar**: User avatars with status
- **PresenceProvider**: React provider for transport-backed awareness state
- **Transport adapters**: BroadcastChannel and WebSocket adapters

## Installation

```bash
pnpm add @softmaple/awareness
```

## Usage

```tsx
import {
  PresenceProvider,
  PresenceBar,
  useUpdateCursor,
} from "@softmaple/awareness";
import { createBroadcastChannelAdapter } from "@softmaple/awareness/adapters";
import "@softmaple/awareness/styles.css";

const adapter = createBroadcastChannelAdapter({
  roomId: "document-123",
  userInfo: {
    userId: "user-1",
    name: "Ada Lovelace",
    color: "#2563eb",
  },
});

function EditorPresence() {
  const updateCursor = useUpdateCursor();

  return (
    <div
      onPointerMove={(event) => {
        updateCursor({
          blockId: "current-block",
          offset: Math.round(event.clientX),
        });
      }}
    >
      <PresenceBar />
    </div>
  );
}

export function App() {
  return (
    <PresenceProvider adapter={adapter}>
      <EditorPresence />
    </PresenceProvider>
  );
}
```

## Adapters

The package includes transport helpers for awareness updates:

- **createWebSocketAdapter**: Standard WebSocket implementation
- **createBroadcastChannelAdapter**: Local BroadcastChannel for same-origin tabs
- **createNoopAdapter**: No-op implementation safe for Next.js SSR, unit
  tests, and Storybook environments where `BroadcastChannel` / `WebSocket`
  are unavailable. It maintains the full state machine and subscriber
  contracts but never touches the network, so a `PresenceProvider` wrapped
  around it renders deterministically and never throws.

The adapter contract is transport-agnostic, so additional providers such as
Supabase Realtime or Liveblocks can be implemented without changing the React
components.

These helpers are transport-focused. They do not own persistent
document merge logic, awareness merge logic, or editor-specific logic.

## WebSocket server contract

`createWebSocketAdapter` exchanges JSON frames of shape:

```ts
{
  type: "join" | "leave" | "presence_update" | "presence_sync"
      | "presence_sync_response" | "heartbeat" | "heartbeat_ack" | "error",
  roomId: string,
  senderId: string,
  timestamp: number,
  payload?: unknown,
}
```

Payload shapes per message type:

| Type                                       | Payload                                                              |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `join`                                     | `{ user: PresenceUser }`                                             |
| `leave`                                    | `{ userId: string }`                                                 |
| `presence_update`                          | `{ userId: string, updates: Partial<Omit<PresenceUser, "userId">> }` |
| `presence_sync` / `presence_sync_response` | `{ users: PresenceUser[] }`                                          |
| `error`                                    | `{ code: string, message: string }`                                  |

Every inbound payload is validated by a runtime type guard
(`src/adapters/websocket/validation.ts`). Malformed frames are dropped and
surfaced via `adapter.onError` instead of crashing consumers.

### Clear-cursor wire semantics

`cursor` and `selection` are optional fields on `PresenceUser`. In the
in-memory model, "no cursor" is represented as `undefined`. JSON serialization
silently drops `undefined`, which would make a `useUpdateCursor(undefined)`
indistinguishable from "no change". To preserve intent on the wire, the
WebSocket adapter:

- **On send:** rewrites `cursor: undefined` / `selection: undefined` to
  `cursor: null` / `selection: null` inside `presence_update` payloads.
- **On receive:** normalizes `cursor: null` / `selection: null` back to
  `undefined` before applying to local state.

Server implementations should mirror this convention — emit `null` (not an
absent key) when a peer clears their cursor.

## Public API

- `@softmaple/awareness`: Root components, provider, hooks, and core types
- `@softmaple/awareness/components`: UI components
- `@softmaple/awareness/hooks`: React hooks
- `@softmaple/awareness/adapters`: Adapter factories and adapter types
- `@softmaple/awareness/adapters/noop`: SSR/test-safe no-op adapter (also
  re-exported from `/adapters`)
- `@softmaple/awareness/state`: Pure state helpers
- `@softmaple/awareness/styles.css`: Component styles

## Development

```bash
# Install dependencies
pnpm i

# Run tests
pnpm test

# Build package
pnpm build

# Start development mode
pnpm dev
```

## License

MIT
