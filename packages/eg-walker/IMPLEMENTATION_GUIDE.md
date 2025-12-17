# Eg-walker Implementation Guide

This document maps the theoretical Eg-walker algorithm (Sections 3.1-3.6) to our TypeScript implementation.

## Algorithm Overview

Eg-walker is a collaborative text editing algorithm based on event graph replay. It ensures convergence across replicas using:
1. **Event Graph**: Persisted DAG of operations
2. **Document State**: Current text with no metadata
3. **Internal State**: Temporary CRDT for merging concurrent edits (not persisted)

## Implementation Mapping

### Core Components (Section 3)

| Algorithm Component | Implementation File | Description |
|-------------------|-------------------|-------------|
| Event Graph | `graph/event-graph.ts` | DAG storage and traversal |
| Document State | `core/external-api.ts` | Index-based external API |
| Internal State | `crdt/internal-state.ts` | Temporary CRDT structure |

### Section 3.1: Characteristics

**Strong List Specification & Non-interleaving:**
- `crdt/non-interleaving.ts` - Ensures concurrent sequences aren't interleaved
- `core/invariants.ts` - Maintains algorithm invariants
- `crdt/temporary-state.ts` - Manages temporary CRDT lifecycle

**Key Properties:**
- ✅ Converges to same state regardless of traversal order
- ✅ Maximally non-interleaving for concurrent insertions
- ✅ Internal state discarded when no concurrency
- ✅ Event graph remains on disk most of the time

### Section 3.2: Walking the Event Graph

**Implementation:** `core/walker.ts`

```typescript
class EgWalker {
  // Topologically sorts events keeping branches consecutive
  // Processes events updating prepare/effect versions
  // Outputs transformed operations
}
```

**Version Management:** `core/version-alignment.ts`
- Manages prepare version (context where event was generated)
- Manages effect version (all events applied so far)
- Computes retreat/advance sequences

### Section 3.3: Prepare and Effect Versions

**Implementation:** `crdt/internal-state.ts`

```typescript
interface CRDTItem {
  id: EventId;           // Event that inserted character
  prepareState: PrepareStateType;  // State in prepare version
  effectState: EffectStateType;    // State in effect version
  // CRDT ordering fields...
}
```

**State Types:** `constants/crdt-states.ts`
- `PREPARE_STATE_TYPE`: NotInsertedYet, Visible, Del1, Del2, ...
- `EFFECT_STATE_TYPE`: Visible, Deleted

**Methods:** `crdt/retreat-advance.ts`
- `apply(e)`: Updates both versions, outputs transformed op
- `retreat(e)`: Removes event from prepare version
- `advance(e)`: Adds event to prepare version

### Section 3.4: Index Mapping

**Transform Mechanics:**

```typescript
// In internal-state.ts
class InternalCRDTState {
  // B-tree for O(log n) index lookups
  indexToRecordPrepare(index: number): CRDTItem
  recordToIndexEffect(record: CRDTItem): number
  
  // Second B-tree: eventId -> record mapping
  eventToRecord: Map<EventId, CRDTItem>
}
```

**Operations:**
- Insert(i, text): Find ith visible character in prepare state
- Delete(i): Mark ith visible character as deleted
- Transform: Map prepare index → effect index

### Section 3.5: Critical Versions

**Implementation:** `core/critical-version.ts`

```typescript
interface CriticalVersionDetector {
  // Version V is critical if it partitions graph:
  // All events before V happened-before all events after V
  isCritical(version: Version, graph: EventGraph): boolean
  findLatestCritical(graph: EventGraph): Version | null
}
```

**Optimizations:**
- Discard internal state at critical versions
- Skip transformation for events between critical versions
- Only replay from most recent critical version

### Section 3.6: Partial Replay

**Implementation:** `core/replay.ts`

```typescript
class ReplayManager {
  // Replays subset of event graph from critical version
  replayFromCritical(criticalVersion: Version, newEvents: Event[])
  
  // Uses placeholders for unknown document content
  initializePlaceholder(range: [number, number])
  
  // Splits placeholders as events are applied
  applyToPlaceholder(event: Event, placeholder: Placeholder)
}
```

**Process:**
1. Find latest critical version before new events
2. Initialize placeholder for document at critical version
3. Replay events from critical version to current
4. Apply new events and output transformed operations

## Architecture Patterns

### Separation of Concerns

```
┌─────────────────┐
│  External API   │  Index-based operations
└────────┬────────┘
         │
┌────────▼────────┐
│   Eg-Walker     │  Coordinates components
└────────┬────────┘
         │
    ┌────┴────┬──────────┬───────────┐
    │         │          │           │
┌───▼──┐ ┌───▼───┐ ┌────▼────┐ ┌────▼────┐
│Graph │ │Version│ │Critical │ │ Replay  │
│      │ │Align  │ │Version  │ │Manager  │
└──────┘ └───────┘ └─────────┘ └─────────┘
         │
┌────────▼────────┐
│  Internal CRDT  │  Temporary state
└─────────────────┘
```

### Key Design Decisions

1. **No Persistent CRDT State**: Internal state is temporary and recreated on demand
2. **Lazy Evaluation**: Event graph stays on disk until concurrency detected
3. **Incremental Updates**: New events transformed without full replay
4. **Memory Efficiency**: Run-length encoding for character runs
5. **Performance**: O(log n) operations using B-trees

## Testing Strategy

### Unit Tests
- `test/internal-state.test.ts` - CRDT operations
- `test/retreat-advance.test.ts` - Version transitions
- `test/critical-version.test.ts` - Critical version detection
- `test/replay.test.ts` - Partial replay logic

### Integration Tests
- `test/walker-integration.test.ts` - Full algorithm flow
- `test/section-3.1-compliance.test.ts` - Spec compliance

### Property-Based Tests
- Non-interleaving guarantees
- Convergence regardless of traversal order
- Invariant preservation

## Performance Characteristics

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| Apply event | O(log n) | Using B-tree indexes |
| Retreat/Advance | O(log n) | Event ID lookup |
| Find critical version | O(\|V\|) | Version comparison |
| Partial replay | O(k log n) | k = events since critical |
| Full replay | O(m log n) | m = total events |

## Usage Example

```typescript
import { EgWalker, EventGraph } from '@softmaple/eg-walker';

// Initialize
const walker = new EgWalker();
const graph = new EventGraph();

// Add event to graph
const event = {
  id: 'e1',
  operation: { type: 'insert', index: 0, text: 'Hello' },
  parents: []
};

graph.addEvent(event);

// Apply event and get transformed operation
const transformedOp = walker.apply(event);

// Document state updated automatically
const text = walker.getText(); // "Hello"
```

## Future Work

- [ ] Section 3.7: Performance heuristics for sort order
- [ ] Section 3.8: Efficient on-disk event graph format
- [ ] Compression and serialization optimizations
- [ ] Network replication layer
- [ ] Collaborative cursors and selections
