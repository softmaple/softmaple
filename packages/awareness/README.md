# @softmaple/awareness

Awareness and presence UI components for real-time collaboration.

## Overview

This package provides transport-agnostic awareness and presence UI components designed for low-interruption, non-blocking collaborative experiences.

Based on the design principles outlined in [docs/design/awareness-and-presence.md](../../docs/design/awareness-and-presence.md).

## Features

- **PresenceBar**: Global awareness of who's online
- **LiveCursor**: Real-time cursor positions
- **SelectionHighlight**: Block selection indicators
- **ActivityIndicator**: Recent activity notifications
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
  AwarenessProvider,
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
    <AwarenessProvider adapter={adapter}>
      <EditorPresence />
    </AwarenessProvider>
  );
}
```

## Adapters

The package supports multiple transport adapters:

- **createWebSocketAdapter**: Standard WebSocket implementation
- **createBroadcastChannelAdapter**: Local BroadcastChannel for same-origin tabs

The adapter contract is transport-agnostic, so additional providers such as
Supabase Realtime or Liveblocks can be implemented without changing the React
components.

## Public API

- `@softmaple/awareness`: Root components, provider, hooks, and core types
- `@softmaple/awareness/components`: UI components
- `@softmaple/awareness/hooks`: React hooks
- `@softmaple/awareness/adapters`: Adapter factories and adapter types
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
