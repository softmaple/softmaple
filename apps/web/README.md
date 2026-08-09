# `@softmaple/web`

Next.js 16 app router host for Softmaple: auth, workspaces, document UI, and
the Lexical editor. Real-time collaboration goes over WebSocket to
[`apps/collab`](../collab/README.md); this app does not write
`document_event_batches` itself.

## Role in the stack

```text
Browser ──► collab-gateway.mjs (public edge)
              ├── HTTP ──► apps/web (Next.js)
              └── /collab/* Upgrade + HMAC ──► apps/collab
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
| `NEXT_ORIGIN` | gateway | Upstream Next origin for `scripts/collab-gateway.mjs` |
| `COLLAB_GATEWAY_PORT` | gateway | Public listen port for the HMAC gateway |
| `COLLAB_GATEWAY_PUBLIC_ORIGIN` | gateway | Browser-facing origin used for Origin checks (TLS edge) |
| `COLLAB_GATEWAY_BIND` | gateway | Bind address (default `127.0.0.1`; use `0.0.0.0` when exposed) |
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

### WebSocket gateway

Stock Next.js cannot proxy WebSocket Upgrades to a separate collab host via
`NextResponse.rewrite`. For split web/collab deployments, put
[`scripts/collab-gateway.mjs`](./scripts/collab-gateway.mjs) on the public
edge: it terminates same-origin `/collab/document` and `/collab/presence`
upgrades, signs them with the shared HMAC, and pipes to
`COLLAB_BACKEND_ORIGIN`. Other HTTP goes to Next. Collab stays private; the
browser never gets a direct backend URL.

```bash
# Example local shape (ports are illustrative)
pnpm --filter @softmaple/collab dev          # :3002
pnpm --filter @softmaple/web dev             # :3001 internal
NEXT_ORIGIN=http://127.0.0.1:3001 \
COLLAB_BACKEND_ORIGIN=http://127.0.0.1:3002 \
COLLAB_GATEWAY_PORT=3000 \
pnpm --filter @softmaple/web gateway
```

Playwright uses the same gateway (`e2e-collab-gateway.mjs` is a thin alias).
`proxy.ts` keeps a signed rewrite fallback if an Upgrade reaches Next directly;
do not treat that as release-equivalent for split hosts.

Before promoting a deployment, verify a real gateway handshake through
`/collab/document`, direct-backend rejection, reconnect, and repair/resync.

Keys and URL must belong to the **same** Supabase project. Never put a
`sb_secret_…` / `service_role` key in these `NEXT_PUBLIC_*` variables.

## Commands

```bash
# Dev (Turbopack). Repo-root `pnpm dev` also starts apps/collab.
pnpm --filter @softmaple/web dev

# HMAC Upgrade gateway (required for real browser collab on split hosts)
pnpm --filter @softmaple/web gateway

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
