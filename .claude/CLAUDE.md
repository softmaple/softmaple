# Claude AI Coding Guidelines for Softmaple

This file contains specific instructions for Claude AI when working on the Softmaple codebase.

## CRITICAL RULES - NEVER VIOLATE

1. **NEVER use `--no-verify` flag when committing** - Pre-commit hooks are essential for code quality. If hooks fail, fix the issues and retry without bypassing.
2. **NEVER commit directly to `next` branch** - Always create a feature branch first.
3. **ALWAYS request user approval before commits/pushes** - No exceptions.

## Project Overview

Softmaple is a Turborepo monorepo containing:

- **apps/web/** - Next.js 16 application with app router
- **packages/** - Shared packages (ui, db, editor, md2latex, etc.)
- **docs/** - Mintlify documentation

## Core Principles

### 1. Functional Programming First

Always prefer functional programming patterns:

**Pure Functions**

- No side effects
- Same input → same output
- Predictable and testable

```typescript
// ✅ Good: Pure function
const calculateTotal = (items: Item[]): number =>
  items.reduce((sum, item) => sum + item.price, 0);

// ❌ Avoid: Side effects
let total = 0;
const calculateTotal = (items: Item[]) => {
  items.forEach((item) => {
    total += item.price;
  });
};
```

**Immutability**

- Never mutate inputs
- Return new objects/arrays
- Use spread operators, map, filter, reduce

```typescript
// ✅ Good: Immutable update
const updateUser = (user: User, name: string): User => ({
  ...user,
  name,
  updatedAt: Date.now(),
});

// ❌ Avoid: Mutation
const updateUser = (user: User, name: string) => {
  user.name = name;
  user.updatedAt = Date.now();
};
```

**Higher-Order Functions**

- Leverage map, filter, reduce
- Pass functions as arguments
- Return functions from functions

```typescript
// ✅ Good: Higher-order function
const withRetry =
  <T>(fn: () => Promise<T>, maxAttempts = 3) =>
  async (): Promise<T> => {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === maxAttempts - 1) throw error;
      }
    }
    throw new Error("Max attempts reached");
  };
```

**Function Composition**

- Build complex logic from small functions
- Use compose/pipe utilities
- Keep functions focused and reusable

```typescript
// ✅ Good: Function composition
const sanitize = (str: string) => str.trim().toLowerCase();
const validate = (str: string) => str.length > 0;
const normalize = (str: string) => str.replace(/\\s+/g, " ");

const processInput = (input: string): string => normalize(sanitize(input));
```

### 2. TypeScript Best Practices

- **No `any` type:** The `@typescript-eslint/no-explicit-any` rule is enforced as an error
- When encountering `any` types:
  1. **Preferred:** Replace with proper types (union types, generics, or specific interfaces)
  2. **If proper typing is not feasible:** Use `@ts-expect-error` with a descriptive comment explaining why
  3. **Never use `@ts-ignore`:** Always use `@ts-expect-error` to ensure the error still exists
- **No TypeScript enums:** Enums are disallowed for performance and bundle-size optimization
  - **Instead:** Use const objects with `as const` assertion
  - **Benefit:** Better tree-shaking, smaller bundle size, no additional runtime code
  - **Example:**

    ```typescript
    // ❌ Avoid: TypeScript enum (generates runtime code)
    enum Status {
      Active = "active",
      Inactive = "inactive",
    }

    // ✅ Good: Const object with as const (zero runtime cost)
    const Status = {
      Active: "active",
      Inactive: "inactive",
    } as const;
    type Status = (typeof Status)[keyof typeof Status];
    ```

- Prefer type inference when obvious
- Use discriminated unions for complex types
- Define interfaces for data structures
- Use readonly for immutable data

```typescript
// ✅ Good: Strict types with readonly
interface Event {
  readonly id: string;
  readonly timestamp: number;
  readonly data: Readonly<EventData>;
}

// ❌ Avoid: Any and mutable
interface Event {
  id: any;
  timestamp: number;
  data: EventData;
}
```

### 3. Error Handling

- Throw explicit errors (avoid console.warn/console.error)
- Include context in error messages
- Handle errors at appropriate boundaries
- Use try-catch for async operations

```typescript
// ✅ Good: Explicit error handling
const getEvent = (id: string, events: Map<string, Event>): Event => {
  const event = events.get(id);
  if (!event) {
    throw new Error(\`Event \${id} not found in events map\`);
  }
  return event;
};

// ❌ Avoid: Silent failures
const getEvent = (id: string, events: Map<string, Event>) => {
  const event = events.get(id);
  if (!event) {
    console.warn("Event not found", id);
  }
  return event;
};
```

### 4. Testing Philosophy

- Write tests for new features
- Ensure all tests pass before committing
- Don't fix unrelated bugs in the same PR
- Use descriptive test names

```bash
# Run package-specific tests
pnpm --filter @softmaple/eg-walker test

# Run all tests
pnpm test
```

## Development Workflow

### Branch Naming

```bash
# Format: type/description-timestamp
feature/add-user-auth-1737154800
refactor/cleanup-event-graph-1737154800
fix/duplicate-event-handling-1737154800
docs/update-readme-1737154800
```

### Branch Protection Rule

**CRITICAL: Never commit directly to the `next` branch.**

Before making any changes:

1. Check current branch: `git branch --show-current`
2. If on `next`, create a new feature branch: `git checkout -b type/description-$(date +%s)`
3. Make your changes on the feature branch
4. Push the feature branch and create a PR

```bash
# Example workflow
git branch --show-current  # Check if on 'next'
git checkout -b refactor/cleanup-types-1737154800
# Now safe to make changes
```

### Returning to `next` Branch

**IMPORTANT: When switching back to `next` from a feature branch, always sync with remote and update dependencies:**

```bash
git checkout next
git pull              # Sync with remote changes
pnpm i                # Update dependencies
```

This ensures:

- You have the latest merged changes from other PRs
- Dependencies are up to date with lockfile changes
- No conflicts or outdated packages

### Commit Messages

```bash
# Format: type(scope): summary
feat(packages/eg-walker): add incremental CRDT integration
refactor(packages/eg-walker): consolidate event tracking
fix(apps/web): resolve duplicate event crash
docs: update functional programming guidelines
```

### Before Committing

1. Run type checks: \`pnpm --filter <package> typecheck\`
2. Run tests: \`pnpm --filter <package> test\`
3. Run linter: \`pnpm lint\`
4. Format code: \`pnpm format\`
5. **NEVER use `--no-verify` flag** - Pre-commit hooks ensure code quality and must not be bypassed
6. **Request user approval before pushing**

### Adding shadcn UI Components

To add shadcn UI components in the turbo repo, run the `add` command in the path of the app:
```bash
pnpm dlx shadcn@latest add [COMPONENT]
```

## Package-Specific Guidelines

### packages/eg-walker/

**CRDT Operations**

- Use immutable patterns for state updates
- Return new Set/Map copies instead of mutating
- Handle out-of-order event delivery gracefully
- Throw explicit errors for invalid states

**Event Graph**

- Validate event IDs before adding
- Handle duplicate events gracefully (log and ignore)
- Maintain topological ordering
- Use coordinator as single source of truth

### apps/web/

**Next.js 16**

- Use app router conventions
- Server components by default
- Client components only when needed
- Follow routing conventions (lowercase-hyphenated)

## Common Patterns

### Updating Collections Immutably

```typescript
// Set operations
const addToSet = <T>(set: ReadonlySet<T>, item: T): Set<T> =>
  new Set([...set, item]);

const removeFromSet = <T>(set: ReadonlySet<T>, item: T): Set<T> =>
  new Set([...set].filter((x) => x !== item));

// Map operations
const updateMap = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): Map<K, V> =>
  new Map(map).set(key, value);

const deleteFromMap = <K, V>(map: ReadonlyMap<K, V>, key: K): Map<K, V> => {
  const newMap = new Map(map);
  newMap.delete(key);
  return newMap;
};
```

### Handling Optional Values

```typescript
// ✅ Good: Optional chaining and nullish coalescing
const getUserName = (user?: User): string => user?.profile?.name ?? "Anonymous";

// Type narrowing
const processEvent = (event: Event) => {
  if ("operation" in event && event.operation.type === "INSERT") {
    const text = event.operation.text ?? "";
    // Process insert operation
  }
};
```

### Graceful Duplicate Handling

```typescript
// ✅ Good: Try-catch for expected failures
const addEventSafely = (graph: EventGraph, event: Event) => {
  try {
    graph.addEvent(event);
  } catch (error) {
    if (error.message.includes("duplicate")) {
      console.log(\`Ignoring duplicate event: \${event.id}\`);
      return; // Graceful ignore
    }
    throw error; // Re-throw unexpected errors
  }
};
```

## What to Avoid

❌ **Don't mutate inputs**

```typescript
// BAD
const addItem = (items: Item[], item: Item) => {
  items.push(item); // Mutation!
};
```

❌ **Don't use @ts-ignore**

```typescript
// BAD
// @ts-ignore
const value = obj.property;

// GOOD
const value = "property" in obj ? obj.property : undefined;
```

❌ **Don't use console.warn/error for control flow**

```typescript
// BAD
if (!found) {
  console.warn("Not found");
  return;
}

// GOOD
if (!found) {
  throw new Error(\`Item not found: \${id}\`);
}
```

❌ **Don't fix unrelated bugs**

- Focus on the task at hand
- Note other issues in your final message
- Create separate issues/PRs for unrelated fixes

## Resources

- Main guidelines: \`AGENTS.md\`
- [Repository](https://github.com/softmaple/softmaple)
- [Documentation](https://docs.softmaple.ink)
