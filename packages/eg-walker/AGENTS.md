# eg-walker Package Guidelines

## Package Overview

This package implements the eg-walker CRDT algorithm for text collaboration, focusing on efficient event management and document synchronization.

## Development Principles

### Functional Programming Paradigm

- **Use immutable data structures** wherever possible
- **Write pure functions** without side effects
- **Compose smaller functions** for complex operations
- **Prefer functional utilities** from `src/fp/utils/`

### Code Organization

- **Core algorithm**: `src/eg-walker.ts` and `src/crdt.ts`
- **Functional utilities**: `src/fp/` module
  - `utils/` - Array, composition, and helper functions
  - `storage/` - Columnar storage implementation
  - `core/` - Functional eg-walker implementation
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

### Performance Optimizations

- Optimizations are enabled by default (`enableOptimizations = true`)
- To disable optimizations: Call `setOptimizationsEnabled(false)` after instantiation
- Benchmark tests in `src/test/benchmark.test.ts` exercise both enabled and disabled paths

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
- Simple compression for content

### Known Limitations

- Character-level CRDT will split multi-character strings
- Some tests expect behavior that conflicts with CRDT semantics
- Out-of-order events require causal ordering
