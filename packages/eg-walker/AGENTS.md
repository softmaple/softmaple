# eg-walker Package Guidelines

## Package Overview

This package implements the eg-walker CRDT algorithm for text collaboration, focusing on efficient event management and document synchronization.

## Development Principles

### Functional Programming Paradigm

- **Use immutable data structures** wherever possible
- **Write pure functions** without side effects
- **Compose smaller functions** for complex operations

### Code Organization

- **Public API**: `src/core/external-api.ts`
- **Replay engine**: `src/engine/eg-walker-engine.ts`
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

- Magic prefix `EGW2` (`0x45 0x47 0x57 0x32`). Older `EGW1` payloads from
  the pre-rewrite scaffolding are not compatible and are rejected at decode.
- Each `IdRun` carries an explicit `custom` flag that distinguishes parsed
  `replicaId:sequence` IDs from verbatim string IDs.
- Inserted content is LZ4-framed. `decodeBinary` enforces a memory cap on
  the destination buffer (4 UTF-8 bytes per declared UTF-16 code unit plus
  64-byte slack) and verifies that the decoded string length matches the
  declared `textLengths` sum, so a tampered payload that truncates or
  inflates content is rejected.

### Known Limitations

- The CRDT layer stores one item per UTF-16 code unit, so a code point
  represented as a surrogate pair (e.g. emoji) is materialised as two
  CRDT items. The public API rejects insert/delete indexes that fall
  between the two halves so concurrent edits cannot produce lone
  surrogates; users must align operations to code-point boundaries.
- Multi-character inserts are stored as a sequence of per-character
  events under a single insert event.
- Remote events with unknown parents are buffered by `EgWalkerReplica` and
  flushed once their causal predecessors arrive; direct `EventGraph.addEvent`
  callers still need to deliver in causal order (or use `EventGraph.deserialize`
  for buffered topological loading).
