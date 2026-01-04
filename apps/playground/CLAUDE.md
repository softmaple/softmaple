# Claude AI Guidelines for Playground App

This file contains specific instructions for Claude AI when working on the Playground application.

## Overview

The Playground app is a Vite + React application for demonstrating various features and experiments. It uses:
- **Vite** for building and development
- **React** with TypeScript
- **TanStack Router** for routing
- **Biome** for formatting and linting
- **Vitest** for unit testing
- **Playwright** for E2E testing

## Code Formatting and Linting

The Playground app uses **Biome** for code formatting and linting. Always use these commands instead of global pnpm commands:

### Biome Commands

```bash
# Format all files
pnpm exec biome format --write

# Format specific files
pnpm exec biome format --write <files>

# Lint and apply safe fixes to all files
pnpm exec biome lint --write

# Lint files and apply safe fixes to specific files
pnpm exec biome lint --write <files>

# Format, lint, and organize imports of all files
pnpm exec biome check --write

# Format, lint, and organize imports of specific files
pnpm exec biome check --write <files>
```

### When to Use Each Command

- **`biome format`**: When you only need to fix formatting issues (indentation, spacing, etc.)
- **`biome lint`**: When you need to fix linting issues (code quality, best practices)
- **`biome check`**: When you want to do everything at once (format + lint + organize imports)

## Pre-commit Hook Issues

If pre-commit hooks fail with Biome errors:

1. Run `pnpm exec biome check --write` on the staged files
2. Stage the fixed files: `git add <fixed-files>`
3. Retry the commit **WITHOUT using `--no-verify`**

## Module Organization

- Keep modules under `src/modules/` for feature-specific code
- Keep components under `src/components/` for reusable UI
- Keep hooks under `src/hooks/` for custom React hooks
- Avoid large files (>200 lines) - split into smaller modules
- Prefer direct imports over barrel exports (index.ts files)

## Testing

```bash
# Run unit tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run E2E tests
pnpm test:e2e

# Type checking
pnpm typecheck
```

## Development

```bash
# Start dev server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## Important Rules

1. **NEVER use `--no-verify` flag** when committing
2. Always fix Biome issues before committing
3. Keep functional programming patterns where possible
4. Avoid `any` types - use proper TypeScript types
5. Test async operations thoroughly
6. Use `crypto.randomUUID()` for ID generation, not `Math.random()`
