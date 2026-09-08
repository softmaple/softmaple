# @softmaple/awareness

Awareness and presence UI components for real-time collaboration.

## Overview

This package provides transport-agnostic awareness and presence UI components designed for low-interruption, non-blocking collaborative experiences.

Based on the design principles outlined in [docs/design/awareness-and-presence.md](../../docs/design/awareness-and-presence.md)
and the [Surface Binding Contract](docs/surface-binding-contract.md).

## Architecture

```text
                       apps/web · apps/playground
            PresenceBar · LiveCursor · BlockActivityIndicator
                                    │
                hooks/ — useUpdateCursor, usePresence, …
                                    │
                            PresenceProvider
                                    │
                         state/ — pure reducers
                  clock-ordered merge · derived status
                                    │
                    AwarenessAdapter (transport seam)
              ┌─────────────────────┬─────────────────────┐
              │                     │                     │
          WebSocket         BroadcastChannel            no-op
         collab host        same-origin tabs         SSR · tests
              │                     │                 Storybook
      apps/collab-nitro        other tabs
   apps/collab-cloudflare
        PresenceRoom
```

Awareness is a **sibling** of the document stack, never a layer inside it. This
package must not import `@softmaple/eg-walker`, `@softmaple/block-model`, a
surface binding, or an editor framework — enforced by Biome's
`style/noRestrictedImports` in [`biome.jsonc`](./biome.jsonc). Presence and the
convergent document meet only inside an app.

That separation is what makes presence disposable: it is ephemeral, lossy by
design, and never durable. Losing a cursor costs nothing; losing an event
batch would be data loss, which is why the two travel over different rooms and
different stores.

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

The package supports multiple transport adapters:

- **createWebSocketAdapter**: Standard WebSocket implementation
- **createBroadcastChannelAdapter**: Local BroadcastChannel for same-origin tabs
- **createNoopAdapter**: No-op implementation safe for Next.js SSR, unit
  tests, and Storybook environments where `BroadcastChannel` / `WebSocket`
  are unavailable. It maintains the full state machine and subscriber
  contracts but never touches the network, so a `PresenceProvider` wrapped
  around it renders deterministically and never throws.

The adapter contract is transport-agnostic, so additional WebSocket or
broadcast providers can be implemented without changing the React components.

## WebSocket server contract

Protocol version: **2**. Capability bits are advertised in the `auth` handshake
(`protocolVersion`, `capabilities`, `connectionId`, `userId`).

`createWebSocketAdapter` exchanges JSON frames of shape:

```ts
{
  type: "auth" | "auth_ok" | "auth_error"
      | "join" | "leave" | "presence:update" | "presence:sync"
      | "presence:sync-response" | "heartbeat" | "heartbeat:ack" | "error",
  roomId: string,
  senderId: string, // connectionId of the sender
  timestamp: number,
  payload?: unknown,
}
```

### Ready handshake

```text
disconnected → connecting → authenticating → syncing → connected
```

`adapter.connect()` resolves only at `connected` (presence ready), not on
socket `open`.

| Type | Payload |
| --- | --- |
| `auth` | `{ token, protocolVersion, capabilities, connectionId, userId }` |
| `auth_ok` | `{}` |
| `auth_error` | `{ message: string }` |
| `join` | `{ user: PresenceUser }` |
| `leave` | `{ connectionId: string, userId: string }` |
| `presence:update` | `{ connectionId, userId, clock, updates }` |
| `presence:sync` / `presence:sync-response` | `{ users: PresenceUser[] }` |
| `heartbeat` / `heartbeat:ack` | `{ pingId: string }` |
| `error` | `{ code: string, message: string }` |

`PresenceUser` includes `connectionId`, `userId`, `lastActivityAt`,
`lastSeenAt`, and `clock`. Heartbeats must only advance `lastSeenAt`.

Status is derived:

```text
lastSeenAt past offlineTimeout → offline
lastActivityAt past idleTimeout → idle
otherwise → active
```

Updates are accepted only when `incoming.clock > known.clock`.

Every inbound payload is validated by a runtime type guard
(`src/adapters/websocket/validation.ts`). Malformed frames are dropped and
surfaced via `adapter.onError` instead of crashing consumers.

Heartbeat ACK deadline (default interval 10s, ACK timeout 20s, 2 misses)
force-closes the socket so half-open NAT/proxy links reconnect.

### Clear-cursor wire semantics

`cursor` and `selection` are optional fields on `PresenceUser`. In the
in-memory model, "no cursor" is represented as `undefined`. JSON serialization
silently drops `undefined`, which would make a `useUpdateCursor(undefined)`
indistinguishable from "no change". To preserve intent on the wire, the
WebSocket adapter:

- **On send:** rewrites `cursor: undefined` / `selection: undefined` to
  `cursor: null` / `selection: null` inside `presence:update` payloads.
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

## Document collaboration chrome

`CollaborationBar` combines connection feedback with a disclosure of everyone in
the document. Inside `PresenceProvider`, it reads the roster and self identity
automatically. Standalone previews can pass `users`, `state`, and `selfUserId`.

```tsx
import { CollaborationBar } from "@softmaple/awareness/components";
import "@softmaple/awareness/styles.css";

<CollaborationBar
  cursorsVisible={cursorsVisible}
  onCursorsVisibleChange={setCursorsVisible}
/>;
```

The host owns cursor visibility and uses it to hide its remote overlay. The
control changes only the local view; keep publishing local presence so others
can still see where you are. Omit the callback to omit the control.

The roster counts people by account ID, shows additional live sessions, filters
expired sessions, and keeps self first followed by names. Activity updates do
not reorder people. Disconnected states hide stale names and counts without
claiming that the document is saved. The panel supports native keyboard button
activation and Escape from inside the panel to close and return focus.

`LiveCursor.caretHeight` accepts a measured line height in pixels; omitting it
preserves the themed default. Initials and name tags use the surface's text
color, so even pale collaborator colors remain readable. Avatars recover from
failed image requests using initials.

Host themes can override `--font-awareness`, `--color-awareness-surface`,
`--color-awareness-border`, `--color-awareness-text`, and
`--color-awareness-muted` on their editor wrapper. See the web app's
`.document-awareness` integration for an example.
