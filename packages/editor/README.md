# `@softmaple/editor`

The Lexical editor surface: composer setup, node registry, toolbar, keyboard
shortcuts, markdown shortcuts, export menu, and the theme that renders them.
Hosts mount `CoreEditor` and add their own document plumbing around it.

Consumed as **source** — `apps/web` lists it in `transpilePackages`, the Vite
apps alias it directly — so there is no build output to keep in sync. The Vite
dev server and Storybook in this package are a local harness for developing the
components, not the way products consume them.

## Role in the stack

```text
      apps/web                                         apps/playground
modules/docs/collab-doc-editor                      LexicalDocumentCanvas
          │                                                   │
          └─────────────────────────┬─────────────────────────┘
                                    │
                            @softmaple/editor
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
     CoreEditor              config/lexical              markdown.ts
   LexicalComposer            theme · nodes          Lexical ⇄ markdown
 Providers · Editor          error boundary                   │
          │                         │                         │
    ToolbarPlugin            PlaygroundNodes         @softmaple/md2latex
   ShortcutsPlugin       heading · list · quote
  MarkdownShortcut             code · link
          │
@softmaple/ui · Tailwind v4
```

**Collaboration is deliberately absent from this package.** It has no
`@softmaple/binding-lexical`, `@softmaple/block-model`, or awareness
dependency. A host composes them by rendering the collaboration plugins as
`children` of `CoreEditor` — that is why `apps/web` can run the same editor
with local history *or* with EG-walker collaboration, without a fork.

| Concern | Owner |
| --- | --- |
| Composer, nodes, toolbar, shortcuts, theme | **this package** |
| Design tokens and primitives | `@softmaple/ui` |
| Markdown → $\LaTeX$ export | `@softmaple/md2latex` |
| Lexical ↔ CRDT binding | `@softmaple/binding-lexical` (mounted by the host) |
| Presence overlays | `@softmaple/awareness` (mounted by the host) |

## Usage

```tsx
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
import { LEXICAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";

<CoreEditor
  lexicalConfig={LEXICAL_PLAYGROUND_CONFIG}
  historyMode="disabled"        // "local" (default) or "disabled"
  showToolbar
  activeEditor={activeEditor}
  setActiveEditor={setActiveEditor}
>
  {/* Host-owned plugins: collaboration binding, presence, autosave… */}
  <LexicalEgWalkerPlugin replica={replica} />
</CoreEditor>;
```

Set `historyMode="disabled"` whenever a collaboration binding is mounted.
Lexical's local history stack and a CRDT both claim authority over undo; running
them together produces undo steps that do not match what other peers see.

Imports are subpath-based (`@softmaple/editor/components/…`,
`@softmaple/editor/config/lexical`, `@softmaple/editor/markdown`) — there is no
barrel entry point.

## Layout

```text
packages/editor/src/
├── components/core/     # CoreEditor, Editor, Providers, ContentEditable
│   ├── plugins/         # Toolbar, Shortcuts, MarkdownShortcut + transformers
│   └── ExportFiles/     # Export dropdown (markdown, LaTeX)
├── config/lexical.tsx   # InitialConfigType: theme, nodes, error boundary
├── nodes/               # PlaygroundNodes registry (heading, list, quote,
│                        #   code, link)
├── context/             # SharedHistory, Toolbar, theme providers
├── markdown.ts          # Lexical editor state ⇄ markdown
├── lib/ · utils/        # cn() and helpers
└── stories/             # Storybook stories
```

## Commands

```bash
pnpm --filter @softmaple/editor dev         # Vite harness
pnpm --filter @softmaple/editor storybook   # component workbench
pnpm --filter @softmaple/editor test
pnpm --filter @softmaple/editor typecheck
pnpm --filter @softmaple/editor lint
```

Stack: React 19, Lexical 0.44, Tailwind CSS v4, shadcn/ui via
`@softmaple/ui`, Vite + Vitest, Storybook.

## Adding a component

This package's [`components.json`](./components.json) maps `components`, `lib`,
and `hooks` to `@softmaple/editor/*`, so running the CLI **here** lands the
files here — which is what you want for an editor-local part:

```bash
cd packages/editor && pnpm dlx shadcn@latest add [COMPONENT]
```

For a primitive every surface should share, add it to `@softmaple/ui` instead;
see [its README](../ui/README.md#adding-a-component) for which directory puts
files where. Either way `ui` and `utils` resolve to `@softmaple/ui`, so the
generated code reuses the shared primitives and `cn()`.

## Related

- [`@softmaple/ui`](../ui/README.md) — design system this builds on
- [`@softmaple/binding-lexical`](../binding-lexical/README.md) — collaboration binding hosts mount alongside it
- [`apps/web`](../../apps/web/README.md) — the production host
