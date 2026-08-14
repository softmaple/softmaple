# `@softmaple/editor`

Lexical rich-text editor used by `apps/web` and `apps/playground`. React 19,
Vite, Tailwind CSS v4, and shadcn/ui primitives from `@softmaple/ui`.

Markdown export goes through `@softmaple/md2latex`. Collaboration bindings are
not in this package; Lexical ↔ EG-walker lives in `@softmaple/binding-lexical`.

## Commands

```bash
# Standalone Vite preview of the editor shell
pnpm --filter @softmaple/editor dev

pnpm --filter @softmaple/editor typecheck
pnpm --filter @softmaple/editor lint
pnpm --filter @softmaple/editor test
pnpm --filter @softmaple/editor storybook
pnpm --filter @softmaple/editor build
```

## Layout

```text
packages/editor/src/
├── components/   # Editor UI (core, export, theme)
├── context/      # Theme provider
├── layout.tsx    # Standalone preview chrome
└── App.tsx       # Vite entry
```
