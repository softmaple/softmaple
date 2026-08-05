# Repository Guidelines

## Project Structure & Module Organization

Turborepo monorepo with `apps/web/` (Next.js 16), `packages/` (shared code), and `docs/` (Mintlify). The web app uses `app/` for routing, `components/` for UI, `modules/` for features. Key packages: `ui/` (design system), `db/` (Prisma), `editor/` (Lexical), `md2latex/` (converter), plus shared configs.

## Build, Test, and Development Commands

- `pnpm dev` - Start development servers (Turbopack)
- `pnpm build` - Build all workspaces
- `pnpm lint` - Run ESLint
- `pnpm format` - Biome formatting
- `pnpm --filter @softmaple/web typecheck` - TypeScript checks
- `pnpm --filter @softmaple/web test:e2e` - Playwright tests
- `pnpm --filter @softmaple/db db:generate` - Regenerate Prisma client

## Coding Style & Naming Conventions

- **Formatting:** 2-space indent, double quotes, semicolons (Biome)
- **Components:** PascalCase filenames
- **Utilities:** camelCase filenames
- **Routes:** lowercase-hyphenated
- **Linting:** ESLint configs in `packages/eslint-config/`
- Husky pre-commit hooks auto-format staged files

### TypeScript Guidelines

- **No `any` type:** The `@typescript-eslint/no-explicit-any` rule is enforced as an error
- When encountering `any` types:
  1. **Preferred:** Replace with proper types (union types, generics, or specific interfaces)
  2. **If proper typing is not feasible:** Use `@ts-expect-error` with a descriptive comment explaining why
  3. **Never use `@ts-ignore`:** Always use `@ts-expect-error` to ensure the error still exists
- **No TypeScript enums:** Enums are disallowed for performance and bundle-size optimization
  - **Instead:** Use const objects with `as const` assertion
  - **Example:**

    ```typescript
    // ❌ Avoid: TypeScript enum
    enum Status {
      Active,
      Inactive,
    }

    // ✅ Good: Const object with as const
    const Status = { Active: "active", Inactive: "inactive" } as const;
    type Status = (typeof Status)[keyof typeof Status];
    ```

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
const addItem = (items: Item[], newItem: Item): void => {
  items.push(newItem);
};

// ✅ Good: Function composition
const processData = compose(validate, transform, sanitize);

// ✅ Good: Higher-order function
const withLogging =
  (fn: Function) =>
  (...args: any[]) => {
    const result = fn(...args);
    return result;
  };
```

## Testing Guidelines

- **Unit tests:** Vitest in `packages/md2latex/tests/` (\*.test.ts)
- **E2E tests:** Playwright in `apps/web/e2e/` (\*.spec.ts)
- **Property tests:** Use the `javascript-testing-expert` skill when writing,
  reviewing, or debugging `fast-check` / `@fast-check/vitest` tests. This skill
  is scoped to property-based testing and is not required for ordinary Vitest
  example tests.
- Run tests before merging
- Regenerate Prisma after schema changes

## Pre-commit Hooks and Code Quality

**CRITICAL: Never use `--no-verify` flag when committing code.** Pre-commit hooks run essential quality checks including:
- Code formatting with Biome
- Linting with ESLint
- Type checking

If pre-commit hooks fail, you must:
1. Fix the issues (run `pnpm format`)
2. Stage the fixes
3. Retry the commit WITHOUT `--no-verify`

Bypassing these checks undermines code quality safeguards and is unacceptable.

## Adding shadcn UI Components

To add shadcn UI components in the turbo repo, run the `add` command in the path of the app:
```bash
pnpm dlx shadcn@latest add [COMPONENT]
```

## Commit & Pull Request Guidelines

**Commits:** `type(scope): summary`

- Types: `fix`, `feat`, `build`, `chore`, `ci`, `docs`, `style`, `refactor`, `perf`, `test`
- Scopes: `apps/web`, `packages/<name>`, or empty for root
- **Branch naming:** `feature-name-$(date +%s)`
- **IMPORTANT: Never commit directly to the `next` branch.** Always create a new feature branch before making changes if you are on the default `next` branch.
- **When switching back to `next` from a feature branch:** Always run `git pull` and `pnpm i` to sync with remote and update dependencies
- **NEVER use `--no-verify` flag when committing** - Pre-commit hooks are critical for code quality and must not be bypassed. Work through any formatting or linting issues instead.
- **Always request user approval before commits/pushes**

**PRs:** Include summary, test commands, screenshots for UI changes

## Documentation

Refer to the [docs.json schema](https://mintlify.com/docs.json) when building the docs.json file and site navigation.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
