# @softmaple/awareness

Awareness and presence UI components for real-time collaboration.

## Overview

This package provides transport-agnostic awareness and presence UI components designed for low-interruption, non-blocking collaborative experiences.

Based on the design principles outlined in [docs/design/awareness-and-presence.md](../../docs/design/awareness-and-presence.md).

## Features (Planned)

- **PresenceBar**: Global awareness of who's online
- **LiveCursor**: Real-time cursor positions
- **SelectionHighlight**: Block selection indicators
- **ActivityIndicator**: Recent activity notifications
- **PresenceAvatar**: User avatars with status

## Installation

```bash
pnpm add @softmaple/awareness
```

## Usage

```tsx
import { AwarenessProvider, useAwareness } from "@softmaple/awareness";
import { WebSocketAdapter } from "@softmaple/awareness/adapters";

// Component implementation coming soon
```

## Adapters

The package supports multiple transport adapters:

- **WebSocketAdapter**: Standard WebSocket implementation
- **BroadcastAdapter**: Local BroadcastChannel for same-origin tabs
- **SupabaseAdapter**: Supabase Realtime integration
- **LiveblocksAdapter**: Migration path from Liveblocks

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
