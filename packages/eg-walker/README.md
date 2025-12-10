# @softmaple/eg-walker

Implementation of the Eg-Walker algorithm for collaborative editing, based on the paper ["Collaborative Text Editing with Eg-walker: Better, Faster, Smaller"](https://arxiv.org/abs/2409.14252).

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
import { EgWalker } from "@softmaple/eg-walker";

// TODO: Add usage examples once implementation is complete
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
# Build the package
pnpm build

# Run in development mode
pnpm dev

# Type checking
pnpm typecheck
```

## References

- [Research Paper](https://arxiv.org/abs/2409.14252)
- [Reference Implementation](https://github.com/josephg/eg-walker-reference)

## License

MIT
