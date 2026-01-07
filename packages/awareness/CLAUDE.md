# @softmaple/awareness Development Guide

## Package Overview

This package provides awareness and presence UI components for real-time collaborative applications. It follows the design principles outlined in [docs/design/awareness-and-presence.md](../../docs/design/awareness-and-presence.md).

## Architecture Principles

### Transport Agnostic
- Components don't directly depend on WebSocket/Supabase/Liveblocks
- All transport logic is handled through adapters
- Easy to switch or support multiple backends

### Low Interruption by Default
- Awareness information should be visible but ignorable
- No blocking modals or toast spam
- Strong signals only appear on hover, focus, or potential conflict

### Functional Programming
- Prefer pure functions without side effects
- Use immutability patterns (return new objects/arrays)
- Leverage higher-order functions and composition
- Keep state transformations predictable

## Directory Structure

```
src/
├── components/      # UI components (PresenceBar, LiveCursor, etc.)
├── hooks/          # React hooks for presence state
├── providers/      # Context providers
├── adapters/       # Transport adapters (WebSocket, Supabase, etc.)
├── types/          # TypeScript type definitions
└── utils/          # Helper functions
```

## Component Guidelines

- Components should be pure and stateless where possible
- Use React.memo for performance optimization
- Follow accessibility best practices (ARIA attributes, keyboard nav)
- Support both light and dark themes
- Minimize re-renders through proper dependency management

## Testing Strategy

- Unit tests for all pure functions
- Component tests using React Testing Library
- Integration tests for adapter implementations
- Visual regression tests for UI components
- Target 80% coverage minimum

## Performance Considerations

- Throttle cursor updates (50-100ms)
- Don't render off-screen cursors
- Use CSS transforms for animations (GPU acceleration)
- Implement virtual scrolling for large user lists
- Clean up stale presence data

## Bundle Size Optimization

- Tree-shakeable exports
- Separate adapter bundles
- Minimal runtime dependencies
- Consider CSS-in-JS alternatives for smaller bundles

## Future Enhancements

1. **Phase 1**: Basic presence bar and user count
2. **Phase 2**: Live cursors and selection highlights
3. **Phase 3**: Activity indicators and minimap
4. **Phase 4**: Advanced features (following mode, conflict resolution)

## Development Commands

```bash
pnpm dev          # Start development mode with watch
pnpm build        # Build production bundle
pnpm test         # Run tests
pnpm test:watch   # Run tests in watch mode
pnpm test:coverage # Generate coverage report
pnpm typecheck    # Check TypeScript types
pnpm lint         # Run ESLint
```
