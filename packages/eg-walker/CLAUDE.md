# Claude AI Guidelines for eg-walker Package

This file contains specific instructions for Claude AI when working on the eg-walker package.

## Package Overview

The `@softmaple/eg-walker` package implements the Eg-walker algorithm for collaborative text editing. It provides:

- **CRDT (Conflict-free Replicated Data Type)** for concurrent editing
- **Event-based synchronization** for distributed collaboration
- **Causal ordering** and topological event management
- **Non-interleaving behavior** for predictable merge outcomes

## Core Architecture

### Key Components

1. **Event Graph** (`src/graph/`)
   - Maintains causal relationships between events
   - Topological ordering of operations
   - Duplicate detection and validation

2. **CRDT State** (`src/crdt/`)
   - Internal state management with immutable patterns
   - Retreat-advance coordinator for state transitions
   - Temporary state for speculative execution

3. **External API** (`src/core/`)
   - `EgWalkerAPI` - Main entry point for applications
   - Local and remote operation handling
   - Version alignment and replay mechanisms

4. **Walker** (`src/core/walker.ts`)
   - Core algorithm implementation
   - State machine for CRDT operations
   - Critical version tracking

## Functional Programming in eg-walker

### Immutable State Management

All state updates must be immutable:

```typescript
// ✅ Good: Return new Set/Map copies
const addEvent = (
  appliedEvents: ReadonlySet<EventId>,
  newEventId: EventId,
): Set<EventId> => new Set([...appliedEvents, newEventId]);

// ❌ Bad: Mutate input
const addEvent = (appliedEvents: Set<EventId>, newEventId: EventId) => {
  appliedEvents.add(newEventId); // Mutation!
};
```

### Pure Transformation Functions

```typescript
// ✅ Good: Pure function for event transformation
const transformEvent = (
  event: GraphEvent,
  prepareVersion: VersionVector,
): GraphEvent => ({
  ...event,
  prepareVersion,
  transformed: true,
});

// ❌ Bad: Side effects
let transformCount = 0;
const transformEvent = (event: GraphEvent) => {
  transformCount++; // Side effect!
  event.transformed = true; // Mutation!
};
```

### Coordinator Pattern

The `RetreatAdvanceCoordinator` is the single source of truth:

```typescript
// ✅ Good: Query coordinator for state
const isApplied = coordinator.isEventApplied(eventId);
const appliedIds = coordinator.getAppliedEventIds();

// ❌ Bad: Duplicate tracking
class State {
  private appliedEvents: Set<EventId>; // Don't duplicate!
}
```

## Error Handling in eg-walker

### Explicit Errors (Not Warnings)

```typescript
// ✅ Good: Throw explicit errors
if (!events.has(eventId)) {
  throw new Error(`Event ${eventId} not found in events map`);
}

// ❌ Bad: Silent failures with console.warn
if (!events.has(eventId)) {
  console.warn("Event not found", eventId);
  return; // Silent failure
}
```

### Graceful Duplicate Handling

```typescript
// ✅ Good: Try-catch for expected duplicates
try {
  eventGraph.addEvent(event);
} catch (error) {
  if (error.message.includes("duplicate")) {
    console.log(`Ignoring duplicate event: ${event.id}`);
    return;
  }
  throw error; // Re-throw unexpected errors
}
```

### Out-of-Order Event Delivery

```typescript
// ✅ Good: Handle missing dependencies gracefully
const missingDeps = prepareVersion.filter(
  (id) => !coordinator.isEventApplied(id),
);
if (missingDeps.length > 0) {
  // Queue event or request missing dependencies
  return { status: "pending", missingDeps };
}
```

## Testing Guidelines

### Current Test Suite

- **92 tests** across 13 test files
- **Coverage thresholds**: 75% lines, 85% functions, 55% branches
- Run tests: `pnpm test`
- Run with coverage: `pnpm test:coverage`

### Test Categories

1. **Algorithm Characteristics** - Core behavior validation
2. **Event Graph** - Topological ordering and validation
3. **CRDT Operations** - State transitions and consistency
4. **Version Alignment** - Synchronization correctness
5. **Replay** - Event replay and recovery
6. **Integration** - End-to-end scenarios

### Writing New Tests

```typescript
// ✅ Good: Descriptive test names
test("should maintain causal order when applying concurrent events", () => {
  // Arrange
  const api1 = new EgWalkerAPI({ replicaId: "replica1" });
  const api2 = new EgWalkerAPI({ replicaId: "replica2" });

  // Act
  const event1 = api1.applyLocalOperation({ type: "INSERT", text: "Hello" });
  const event2 = api2.applyLocalOperation({ type: "INSERT", text: "World" });

  // Assert
  expect(api1.getText()).toBe("Hello");
  api1.applyRemoteEvent(event2);
  expect(api1.getText()).toBe("HelloWorld");
});
```

### Test Patterns to Avoid

```typescript
// ❌ Bad: Using @ts-ignore
// @ts-ignore
const value = crdt.privateMethod();

// ✅ Good: Type narrowing
if ("privateMethod" in crdt && typeof crdt.privateMethod === "function") {
  const value = crdt.privateMethod();
}
```

## Code Organization

### File Structure

```
src/
├── constants/     # Enums, config, sentinels
├── core/          # Main API and algorithm
├── crdt/          # CRDT state management
├── graph/         # Event graph structures
├── types/         # TypeScript type definitions
└── test/          # Test files
```

### Module Boundaries

- **Core modules** should not import from test files
- **Index files** should only re-export, no logic
- **Constants** are shared across modules
- **Types** define interfaces between modules

## Performance Considerations

### Avoid O(n²) Operations

```typescript
// ❌ Bad: Replaying all events every time
for (const remoteEvent of remoteEvents) {
  const tempCRDT = new TemporaryCRDT();
  for (const event of allEvents) {
    // O(n²)!
    tempCRDT.apply(event);
  }
}

// ✅ Good: Incremental integration
const persistentCRDT = new ConcreteCRDT();
for (const remoteEvent of remoteEvents) {
  const newItems = computeDelta(remoteEvent, persistentCRDT);
  persistentCRDT.integrate(newItems);
}
```

### Use Efficient Data Structures

- `Map<EventId, GraphEvent>` for O(1) event lookup
- `Set<EventId>` for O(1) membership checks
- `ReadonlySet`/`ReadonlyMap` for immutable views

## Common Patterns

### Event Processing

```typescript
// Pattern: Apply local operation
const event = api.applyLocalOperation({
  type: OPERATION_TYPE.INSERT,
  position: 0,
  text: "Hello",
});

// Pattern: Apply remote event
api.applyRemoteEvent(event);

// Pattern: Get current state
const text = api.getText();
const version = api.getCurrentVersion();
```

### Version Vectors

```typescript
// Pattern: Create version vector
const version: VersionVector = ["event1", "event2", "event3"];

// Pattern: Check if version is applied
const isApplied = version.every((id) => coordinator.isEventApplied(id));
```

## Before Committing

1. ✅ Run `pnpm --filter @softmaple/eg-walker test` - All tests pass
2. ✅ Run `pnpm --filter @softmaple/eg-walker test:coverage` - Coverage thresholds met
3. ✅ Run `pnpm --filter @softmaple/eg-walker typecheck` - No TypeScript errors
4. ✅ Check that no `@ts-ignore` comments were added
5. ✅ Verify immutable patterns are used throughout
6. ✅ Request user approval before committing

## Resources

- [Root guidelines](../../.claude/CLAUDE.md)
- [Repository guidelines](../../AGENTS.md)
- [Eg-walker paper](https://arxiv.org/abs/2409.14252)
- Package tests: `src/test/`
