# Playground App Development Guidelines

This file contains instructions for AI agents and developers working on the Playground application.

## Code Formatting and Linting

This app uses **Biome** for code formatting and linting. Use these commands to maintain code quality:

### Biome Command Reference

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

### Usage Guidelines

#### When to use `biome format`
- Fixing indentation and spacing issues
- Correcting quote styles (single vs double)
- Fixing line endings and trailing commas

#### When to use `biome lint`
- Fixing code quality issues
- Applying best practices
- Removing unused imports
- Fixing potential bugs

#### When to use `biome check`
- Before committing (comprehensive check)
- After refactoring
- When you want to fix everything at once

## Pre-commit Hook Troubleshooting

If pre-commit hooks fail:

```bash
# 1. Check what files have issues
git status

# 2. Fix all staged files
pnpm exec biome check --write $(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$')

# 3. Stage the fixes
git add -u

# 4. Retry commit (NEVER use --no-verify)
git commit -m "your message"
```

## Project Structure

```
apps/playground/
├── src/
│   ├── components/     # Reusable UI components
│   ├── hooks/         # Custom React hooks
│   ├── modules/       # Feature modules (keep small, <200 lines)
│   ├── routes/        # TanStack Router pages
│   ├── lib/           # Utility functions
│   └── test/          # Unit tests
├── e2e/               # Playwright E2E tests
└── public/            # Static assets
```

## Development Commands

```bash
# Development
pnpm --filter playground dev     # Start dev server
pnpm --filter playground build   # Build for production
pnpm --filter playground preview # Preview production build

# Testing
pnpm --filter playground test           # Run unit tests
pnpm --filter playground test:coverage  # Run tests with coverage
pnpm --filter playground test:e2e       # Run E2E tests

# Type checking
pnpm --filter playground typecheck
```

## Code Style Guidelines

1. **Functional Programming**: Prefer pure functions, immutability, and function composition
2. **TypeScript**: No `any` types, use proper type definitions
3. **Async Operations**: Always handle promises properly with async/await
4. **ID Generation**: Use `crypto.randomUUID()` for secure IDs
5. **Module Size**: Keep files under 200 lines, split large modules
6. **Imports**: Use direct imports, avoid barrel exports (index.ts)

## Common Issues and Solutions

### Biome Formatting Issues
```bash
# Quick fix for all formatting issues
pnpm exec biome format --write src/
```

### Biome Linting Issues
```bash
# Apply safe auto-fixes
pnpm exec biome lint --write src/
```

### Import Organization Issues
```bash
# Organize imports automatically
pnpm exec biome check --write src/
```

### TypeScript Errors
```bash
# Check for type errors
pnpm --filter playground typecheck
```

## Important Notes

- **NEVER use `--no-verify` flag** when committing - always fix issues properly
- **DO NOT use `pnpm dev`** directly - use `pnpm --filter playground dev`
- Biome configuration is in `biome.json` at the project root
- Pre-commit hooks will run Biome automatically on staged files
- If Biome and Prettier conflict, Biome takes precedence in this project
