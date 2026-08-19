# `@softmaple/ui`

The shared design system: shadcn/ui components (new-york style, Radix
primitives, Lucide icons) plus the Tailwind CSS v4 theme that every Softmaple
surface renders against.

The package ships **source**, not a build. Consumers compile it themselves —
`apps/web` through `transpilePackages`, the Vite apps through their own
pipeline — so there is no `dist/`, no duplicated React, and no stale build to
regenerate after an edit.

## Role in the stack

```text
       apps/web             apps/playground         packages/editor
      Next.js 16            TanStack Start         Lexical UI shell
           │                       │                       │
           └───────────────────────┼───────────────────────┘
                                   │
                             @softmaple/ui
                                   │
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
     /components/*        /styles/globals.css           /lib/*
      Radix + CVA         tokens · dark mode          cn() helper
           │                       │                       │
      @radix-ui/*           Tailwind CSS v4             clsx +
     lucide-react           tw-animate-css          tailwind-merge
```

`globals.css` is the single theme definition: OKLCH design tokens on `:root`,
their dark counterparts under the `.dark` variant, and `@source` globs that
pull class names out of the consuming apps so Tailwind's scanner sees them.
Importing it twice from two apps is fine; defining a second token set is not.

## Usage

Subpath imports only — there is no barrel entry point, so an app never pays for
components it does not render:

```tsx
import { Button } from "@softmaple/ui/components/button";
import { cn } from "@softmaple/ui/lib/utils";

<Button variant="outline" className={cn("w-full", className)}>
  Save
</Button>;
```

Import the theme once, at the app's root stylesheet:

```css
@import "@softmaple/ui/globals.css";
```

| Subpath | Contents |
| --- | --- |
| `@softmaple/ui/components/*` | One component per file (`button`, `dialog`, `select`, …) |
| `@softmaple/ui/lib/*` | `utils` → `cn()` (clsx + tailwind-merge) |
| `@softmaple/ui/hooks/*` | Shared React hooks |
| `@softmaple/ui/globals.css` | Tailwind v4 theme, design tokens, dark mode |
| `@softmaple/ui/postcss.config` | Shared PostCSS config for consumers |

Current components: `avatar`, `badge`, `button`, `card`, `dialog`,
`dropdown-menu`, `input`, `label`, `scroll-area`, `select`, `separator`,
`sheet`, `skeleton`, `sonner`, `switch`, `tabs`, `textarea`, `tooltip`.

## Adding a component

Run the shadcn CLI **in the app directory**, not at the repo root — the CLI
resolves aliases from that app's `components.json`:

```bash
pnpm dlx shadcn@latest add [COMPONENT]
```

Aliases are already configured in [`components.json`](./components.json) to
point at `@softmaple/ui/components`, `@softmaple/ui/lib`, and
`@softmaple/ui/hooks`, so generated files land in this package rather than
being copied into each app.

Keep components presentational: no data fetching, no Supabase client, no
collaboration or awareness imports. A component that needs live state takes it
as props.

## Commands

```bash
pnpm --filter @softmaple/ui lint
```

Consumers typecheck this package as part of their own build, since it is
compiled from source.

## Related

- [`packages/editor`](../editor/README.md) — the Lexical editor built on these parts
- [`packages/awareness`](../awareness/README.md) — presence UI, styled independently
