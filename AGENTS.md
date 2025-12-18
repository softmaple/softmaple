# Repository Guidelines

## Project Structure & Module Organization
Turborepo monorepo with `apps/web/` (Next.js 16), `packages/` (shared code), and `docs/` (Mintlify). The web app uses `app/` for routing, `components/` for UI, `modules/` for features. Key packages: `ui/` (design system), `db/` (Prisma), `editor/` (Lexical), `md2latex/` (converter), plus shared configs.

## Build, Test, and Development Commands
- `pnpm dev` - Start development servers (Turbopack)
- `pnpm build` - Build all workspaces
- `pnpm lint` - Run ESLint
- `pnpm format` - Prettier formatting
- `pnpm --filter @softmaple/web typecheck` - TypeScript checks
- `pnpm --filter @softmaple/web test:e2e` - Playwright tests
- `pnpm --filter @softmaple/db db:generate` - Regenerate Prisma client

## Coding Style & Naming Conventions
- **Formatting:** 2-space indent, double quotes, semicolons (Prettier)
- **Components:** PascalCase filenames
- **Utilities:** camelCase filenames  
- **Routes:** lowercase-hyphenated
- **Linting:** ESLint configs in `packages/eslint-config/`
- Husky pre-commit hooks auto-format staged files

### Functional Programming Principles
Where possible, prefer functional programming patterns:
- **Pure functions:** Functions should not have side effects and should return the same output for the same inputs
- **Immutability:** Avoid mutating data structures; return new copies instead (use spread operators, `Array.map()`, `Object.freeze()`, etc.)
- **Higher-order functions:** Leverage functions that take or return other functions (e.g., `map`, `filter`, `reduce`)
- **Function composition:** Build complex logic by composing smaller, reusable functions

Examples:
```typescript
// ✅ Good: Pure function with immutability
const addItem = (items: Item[], newItem: Item): Item[] => [...items, newItem];

// ❌ Avoid: Mutating input
const addItem = (items: Item[], newItem: Item): void => { items.push(newItem); };

// ✅ Good: Function composition
const processData = compose(validate, transform, sanitize);

// ✅ Good: Higher-order function
const withLogging = (fn: Function) => (...args: any[]) => {
  const result = fn(...args);
  return result;
};
```

## Testing Guidelines
- **Unit tests:** Vitest in `packages/md2latex/tests/` (*.test.ts)
- **E2E tests:** Playwright in `apps/web/e2e/` (*.spec.ts)  
- Run tests before merging
- Regenerate Prisma after schema changes

## Commit & Pull Request Guidelines
**Commits:** `type(scope): summary`
- Types: `fix`, `feat`, `build`, `chore`, `ci`, `docs`, `style`, `refactor`, `perf`, `test`
- Scopes: `apps/web`, `packages/<name>`, or empty for root
- **Branch naming:** `feature-name-$(date +%s)`
- **IMPORTANT: Never commit directly to the `next` branch.** Always create a new feature branch before making changes if you are on the default `next` branch.
- **Always request user approval before commits/pushes**

**PRs:** Include summary, test commands, screenshots for UI changes

## Documentation
Refer to the [docs.json schema](https://mintlify.com/docs.json) when building the docs.json file and site navigation.
