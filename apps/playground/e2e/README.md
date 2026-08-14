# Playground E2E

Playwright specs for the Softmaple playground demos.

```bash
pnpm --filter @softmaple/playground test:e2e
pnpm --filter @softmaple/playground test:e2e:ui
```

Specs cover the home page, Lexical × EG-walker (including WebSocket and
BroadcastChannel transports), awareness merge, the collaborative editor, and
the two-panel editor. Playwright starts the Vite dev server on
http://localhost:3000.
