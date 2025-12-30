# @softmaple/eg-walker

Implementation of the Eg-Walker algorithm for collaborative editing, based on the paper ["Collaborative Text Editing with Eg-walker: Better, Faster, Smaller"](https://arxiv.org/abs/2409.14252).

[![Test Coverage](https://img.shields.io/badge/coverage-88%25-green)](./coverage)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

## Overview

Eg-Walker is a novel algorithm for collaborative text editing based on event graph replay. The algorithm builds on a replication layer that ensures all non-crashed replicas eventually receive every event.

### Architecture

Each replica's state consists of three parts:

1. **Event Graph (Persistent)**: Stores a complete copy of all events on disk. Events include operations (insert/delete), IDs, and parent versions.

2. **Document State (Persistent)**: The current sequence of characters with no metadata. Stored as plain text on disk; in memory represented as an array or rope for efficient operations.

3. **Internal State (Temporary)**: A CRDT structure used to merge concurrent edits. Not persisted or replicated between replicas. Discarded after processing and rebuilt when needed.

### Key Benefits

- **Better**: Produces more intuitive merge results than traditional CRDTs
- **Faster**: Efficient implementation with minimal overhead
- **Smaller**: Compact representation of document state and operations

### How It Works

The algorithm uses a two-phase approach:

1. **Prepare Phase**: Retreat/advance the internal CRDT state to align with an event's parent version
2. **Apply Phase**: Execute the operation (insert or delete) in the prepared context

This allows it to handle complex concurrent editing scenarios by maintaining both an "effect state" (what the user sees) and a "prepare state" (used for positioning new operations).

## Installation

```bash
pnpm add @softmaple/eg-walker
```

## Usage

```typescript
import { EgWalkerAPI, createEgWalker } from "@softmaple/eg-walker";

// Create a new instance
const walker = createEgWalker("replica-1");

// Apply local operations
walker.applyLocalOperation({
  type: "insert",
  position: 0,
  text: "Hello, World!"
});

walker.applyLocalOperation({
  type: "delete",
  position: 7,
  count: 6
});

// Apply remote events
walker.applyRemoteEvent(remoteEvent);

// Get current document state
const text = walker.getDocumentState();
console.log(text); // "Hello, !"

// Serialize for persistence
const serialized = walker.serialize();

// Restore from serialized state
const restored = EgWalkerAPI.deserialize(serialized, "replica-2");
```

## Features

- **Augmented CRDT**: Extends traditional CRDTs with prepare/effect state separation
- **Time-travel**: Support for retreat and advance operations to any document version
- **Efficient Diffing**: Fast computation of version differences using causal graphs
- **Intuitive Merging**: Produces results that match user expectations better than pure CRDTs
- **Concurrent Delete Handling**: Properly tracks items deleted multiple times concurrently

## Algorithm Components

### Core Data Structures

- **AugmentedCRDTItem**: Extended CRDT items with both effect and prepare states
  - `id`: Unique identifier for the item
  - `originLeft`, `originRight`: CRDT positioning information
  - `ever_deleted`: Tracks if item has been deleted in effect state
  - `prepare_state`: Current state in prepare version (0=not inserted, 1=inserted, 2+=deleted n-1 times)

- **EventStorage**: Stores all editing events with causal ordering
- **Version Frontiers**: Tracks document versions for efficient diffing

### Key Operations

1. **Prepare Phase**:
   - Retreat: Decrement prepare_state for events only in current version
   - Advance: Increment prepare_state for events only in target version

2. **Apply Phase**:
   - Insert: Find position using prepare_state, integrate with CRDT rules
   - Delete: Mark item as deleted in both effect and prepare states

3. **Integration**: Use underlying CRDT (e.g., RGA) for concurrent operation ordering

## Development

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Run in development mode
pnpm dev

# Type checking
pnpm typecheck

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests in watch mode
pnpm test:watch
```

## Testing

The package maintains high test coverage (88%+) with comprehensive unit tests for:

- Core algorithm implementation
- CRDT operations (insert, delete, merge)
- Event graph management
- Retreat/advance functionality
- Non-interleaving behavior
- Concurrent operation handling
- Serialization/deserialization

Run tests with:
```bash
pnpm test
pnpm test:coverage  # Generate coverage report
```

## API Reference

### `EgWalkerAPI`

The main API class for interacting with the Eg-Walker algorithm.

#### Methods

- `applyLocalOperation(operation)` - Apply a local insert or delete operation
- `applyRemoteEvent(event)` - Apply an event from a remote replica
- `getDocumentState()` - Get the current document text
- `serialize()` - Serialize the current state for persistence
- `static deserialize(data, replicaId)` - Restore from serialized state

### `createEgWalker(replicaId, options?)`

Factory function to create a new EgWalker instance.

#### Parameters

- `replicaId`: Unique identifier for this replica
- `options`: Optional configuration object

### Types

```typescript
type Operation = 
  | { type: "insert"; position: number; text: string }
  | { type: "delete"; position: number; count: number };

type Event = {
  id: EventId;
  operation: Operation;
  parentVersion: Version;
  replicaId: string;
};
```

## References

- [Research Paper](https://arxiv.org/abs/2409.14252)
- [Reference Implementation](https://github.com/josephg/eg-walker-reference)
- [Algorithm Characteristics Tests](./src/test/algorithm-characteristics.test.ts)
- [Integration Tests](./src/test/external-api.test.ts)

## License

MIT
