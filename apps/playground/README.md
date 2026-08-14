# `@softmaple/playground`

TanStack Start app that hosts live Softmaple collaboration demos: Lexical ×
EG-walker, WebSocket rooms, awareness/presence, and local CRDT editors.

This is not the product host. Auth, workspaces, and durable document history
live in [`apps/web`](../web/README.md) and the collaboration runtimes.

## Demos

Listed from [`src/lib/demos.ts`](./src/lib/demos.ts):

| Route | What it shows |
| --- | --- |
| `/demo/lexical-eg-walker` | Lexical + block-model CRDT, document sync, live presence |
| `/demo/online-collab-editor` | Plain-text rooms over WebSocket |
| `/demo/awareness-collab` | Cursors, selection highlights, and presence |
| `/demo/collaborative-editor` | Side-by-side EG-walker text replicas |
| `/demo/two-panel-editor` | Independent editors (no CRDT sync) |

## Setup

From the monorepo root:

```bash
pnpm install
pnpm --filter @softmaple/playground dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional client variables (see [`src/env.ts`](./src/env.ts)):

| Variable | Notes |
| --- | --- |
| `VITE_PLAYGROUND_DEVTOOLS` | `true` to show TanStack devtools |
| `VITE_COLLAB_TRANSPORT` | `websocket` (default) or `broadcast` |
| `VITE_COLLAB_DOC_WS_URL` | Override document-sync WebSocket base URL |
| `VITE_COLLAB_PRESENCE_WS_URL` | Override presence WebSocket base URL |
| `VITE_COLLAB_SYNC_WS_URL` | Override textarea SyncAdapter WebSocket URL |

## Commands

```bash
pnpm --filter @softmaple/playground dev
pnpm --filter @softmaple/playground typecheck
pnpm --filter @softmaple/playground test
pnpm --filter @softmaple/playground test:e2e
pnpm --filter @softmaple/playground build
```

E2E coverage is in [`e2e/`](./e2e). Playwright starts the Vite dev server.

## Layout

```text
apps/playground/
├── src/
│   ├── routes/          # TanStack Router pages
│   ├── modules/         # Demo feature modules
│   ├── components/      # Shared UI
│   └── env.ts           # Typed Vite env
└── e2e/                 # Playwright specs
```
