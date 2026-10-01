# eg-walker Package Guidelines

## Package Overview

This package implements the eg-walker CRDT algorithm for text collaboration, focusing on efficient event management and document synchronization.

## Development Principles

### Functional Programming Paradigm

- **Use immutable data structures** wherever possible
- **Write pure functions** without side effects
- **Compose smaller functions** for complex operations

### Code Organization

- **Public API**: `src/core/replica.ts`
- **Replay engine**: `src/engine/eg-walker-engine.ts` (orchestrator) with engine-private helpers under `src/engine/internals/`
- **Graph and storage**: `src/graph/event-graph.ts`, `src/graph/columnar-codec.ts`
- **Tests**: `src/test/` with corresponding `.test.ts` files

### Coding Style

- **TypeScript strict mode** - All code must pass `pnpm typecheck`
- **Small focused functions** - Each function should do one thing well
- **Type safety** - Avoid `any` types, handle undefined values explicitly
- **Documentation** - Add JSDoc comments for public APIs

### Testing

- Run tests: `pnpm --filter @softmaple/eg-walker test`
- Run typecheck: `pnpm --filter @softmaple/eg-walker typecheck`
- Run build: `pnpm --filter @softmaple/eg-walker build`
- Use the `javascript-testing-expert` skill for `fast-check` or
  `@fast-check/vitest` property tests. Do not invoke it solely for regular
  example-based Vitest tests.

### Commit Guidelines

- Use scope: `packages/eg-walker` not just `eg-walker`
- Example: `fix(packages/eg-walker): correct event ordering`
- Always request explicit user approval before commits

## Architecture Notes

### Event Graph Structure

The implementation follows the three-part architecture from the paper:

1. **Event graph**: Stored on disk in columnar format
2. **Document state**: Current text with no metadata
3. **Internal CRDT state**: Temporary structure for merging

### Columnar Storage Format

Events are stored in compressed columnar format:

- Topologically sorted events
- Separate columns for type, position, content, parents, IDs
- Run-length encoding for consecutive operations
- LZ4-framed compression for inserted content

### Binary Format

- Every encoder writes EGW4 (magic `EGW4`, `0x45 0x47 0x57 0x34`); the full
  layout is documented in `src/graph/columnar-codec/egw4-format.ts`.
  `decodeBinary` also reads EGW3, so snapshots written before EGW4 still
  load and are saved as EGW4 the next time they are encoded. `EGW1` and
  `EGW2` payloads are rejected.
- Replica IDs and custom event IDs are written once in a string table; ID
  runs refer to them by index and store a start sequence only when a
  replica's sequence jumps.
- Parents are numbers: an override stores its gap from the previous
  override, its parent count (packed into the same varint up to 2) and each
  parent's distance back from the event. Every other event's only parent is
  the previous event.
- Edits are spans: a run of typing, of deletes at one index (delete key) or
  of backspaces is one `(count * 4 + kind, anchor delta)` pair, with indexes
  inside the span derived from the run-length encoded lengths column.
- Timestamps are delta segments: a first delta plus a constant step, or a
  literal run of deltas.
- Inserted content is LZ4-framed UTF-8. The decoder caps the destination
  buffer at 3 bytes per declared UTF-16 code unit plus 64, rejects malformed
  UTF-8 and checks that the decoded length matches the lengths column and
  that no insert splits a surrogate pair.
- A CRC-32 of the payload ends it, so a flipped, dropped or extra byte is
  rejected before anything else is decoded.
- A payload holds at most `EGW4_MAX_EVENTS` (2^25) events. Runs let a few
  bytes declare many events, so the decoder rejects a larger count before
  allocating any per-event column, and encoders refuse larger graphs.

### Known Limitations

- The CRDT layer addresses one item per UTF-16 code unit, `(event, offset)`,
  so a code point represented as a surrogate pair (e.g. emoji) is two CRDT
  items even when one run record stores both. The public API rejects
  insert/delete indexes that fall between the two halves so concurrent
  edits cannot produce lone surrogates; users must align operations to
  code-point boundaries.
- A multi-character insert is a single insert event, and replay stores it
  as one insert-run record that splits only where a later insert or delete
  lands.
- Remote events with unknown parents are buffered by `EgWalkerReplica` and
  flushed once their causal predecessors arrive; direct `EventGraph.addEvent`
  callers still need to deliver in causal order (or use `EventGraph.deserialize`
  for buffered topological loading).
