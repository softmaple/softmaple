# `@softmaple/web`

Next.js 16 app router host for Softmaple: auth, workspaces, document UI, and
the Lexical editor. Real-time collaboration goes over WebSocket to
[`apps/collab`](../collab/README.md); this app does not write
`document_event_batches` itself.

## Role in the stack

```text
Browser ──► apps/web (Next.js)
              ├── Supabase Auth / Data API (anon / publishable key)
              ├── same-origin /collab/document (durable EG-walker history)
              └── same-origin /collab/presence (ephemeral awareness)
                    └── HMAC rewrite ──► apps/collab ──► Supabase Postgres
```

| Concern | Owner |
| --- | --- |
| Auth, dashboards, settings, routing | **this app** |
| Lexical UI + editor shell | `@softmaple/editor` + `modules/docs` |
| Lexical ↔ EG-walker binding | `@softmaple/binding-lexical` |
| Collab wire protocol | `@softmaple/collab-protocol` |
| Durable event store / fan-out | [`apps/collab`](../collab/README.md) |
| Schema, RLS, Prisma | [`packages/db`](../../packages/db) |

Layer boundaries:
[`docs/design/collaboration-layers.md`](../../docs/design/collaboration-layers.md).

## Setup

From the monorepo root:

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
# Also configure packages/db/.env and apps/collab/.env.local
pnpm --filter @softmaple/db db:generate
pnpm --filter @softmaple/db db:migrate
```

### Environment

Copy [`.env.example`](./.env.example). Values are resolved in
[`utils/supabase/config.ts`](./utils/supabase/config.ts).

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project URL (`https://<ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes* | Prefer `sb_publishable_…` from **Settings → API Keys** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | Legacy JWT `anon` key; used only if publishable key is unset |
| `COLLAB_BACKEND_ORIGIN` | yes | Private collab service origin, for example `http://localhost:3002` |
| `COLLAB_GATEWAY_HMAC_KEY_ID` | yes | Active key ID installed in the collab keyring |
| `COLLAB_GATEWAY_HMAC_SECRET` | yes | Active 32-byte, unpadded base64url HMAC secret |
| `NEXT_PUBLIC_APP_URL` | production | Canonical origin used in auth redirects |

\*Required unless `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set.

`NEXT_PUBLIC_*` values are inlined at **build** time. After changing them in
Vercel (or any host), redeploy — restarting the running server is not enough.

The collaboration gateway variables are server-only. Never prefix the HMAC
secret with `NEXT_PUBLIC_` or expose the collab backend directly to browsers.
The browser always connects to the current web origin at `/collab/document`
and `/collab/presence`.

The server-only E2E seed endpoint is disabled by default. It activates only
when `E2E_ALLOW_REMOTE_SEED=true`, the supplied project ref exactly matches the
Supabase URL, a distinct production ref is configured, and a service-role key
plus bearer secret are present. Never enable it against production.

### WebSocket release gate

The stock Next.js 16.3 local server does not provide a release-equivalent
external WebSocket rewrite path for `proxy.ts`: local HTTP Proxy tests pass,
but an Upgrade request does not reach the rewrite destination. Do not work
around this by exposing an unsigned backend URL to the browser.

Playwright starts an Upgrade-capable reverse proxy
(`scripts/e2e-collab-gateway.mjs`) in front of `next dev` so core E2E can exercise
HMAC-signed `/collab/document` and `/collab/presence` handshakes locally.
That proxy is still not a Vercel Preview substitute.

Before promoting a deployment, verify a real Vercel Preview handshake through
`/collab/document`, direct-backend rejection, reconnect, and repair/resync.
Also configure a Vercel Firewall rate limit for the public gateway path. See
[Vercel WebSockets](https://vercel.com/docs/functions/websockets).

Keys and URL must belong to the **same** Supabase project. Never put a
`sb_secret_…` / `service_role` key in these `NEXT_PUBLIC_*` variables.

## Commands

```bash
# Dev (Turbopack). Repo-root `pnpm dev` also starts apps/collab.
pnpm --filter @softmaple/web dev

pnpm --filter @softmaple/web typecheck
pnpm --filter @softmaple/web lint
pnpm --filter @softmaple/web test
pnpm --filter @softmaple/web test:e2e
pnpm turbo run build --filter=@softmaple/web
```

Real product E2E requires the isolated variables documented in
[`docs/development.mdx`](../../docs/development.mdx). It starts Web and Collab
on dynamic ports with `reuseExistingServer=false`; no mock client or forged
authentication cookie is used.

## Layout

```text
apps/web/
├── app/                 # App Router pages, server actions, API routes
├── modules/             # Feature UI (auth, docs, workspaces, settings)
├── components/          # Shared UI
├── utils/supabase/      # Browser / server / middleware clients + config
└── e2e/                 # Playwright specs
```

## Related docs

- [Development setup](../../docs/development.mdx)
- [Quickstart](../../docs/quickstart.mdx)
- [Collaboration service](../collab/README.md)
- [Supabase DB / security](../../packages/db/supabase/README.md)
