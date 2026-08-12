# `@softmaple/web`

Next.js 16 app router host for Softmaple: auth, workspaces, document UI, and
the Lexical editor. Real-time collaboration goes over same-origin WebSocket
paths to [`apps/collab`](../collab/README.md); this app does not write
`document_event_batches` itself and does not proxy WebSocket upgrades.

## Role in the stack

```text
Browser ──► apps/web (Next.js)
              ├── Supabase Auth / Data API (anon / publishable key)
              └── same-origin /collab/* (routed by Vercel Services)
                    └── apps/collab ──► Redis + Supabase Postgres
```

| Concern | Owner |
| --- | --- |
| Auth, dashboards, settings, routing | **this app** |
| Lexical UI + editor shell | `@softmaple/editor` + `modules/docs` |
| Lexical ↔ EG-walker binding | `@softmaple/binding-lexical` |
| Collab wire protocol | `@softmaple/collab-protocol` |
| Durable event store / Redis fan-out | [`apps/collab`](../collab/README.md) |
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
| `NEXT_PUBLIC_APP_URL` | production | Canonical origin used in auth redirects |

\*Required unless `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set.

`NEXT_PUBLIC_*` values are inlined at **build** time. After changing them in
Vercel (or any host), redeploy — restarting the running server is not enough.

Collaboration Redis credentials and collab private hosts must never be exposed
through `NEXT_PUBLIC_*` variables. By default the browser connects to the
current web origin at `/collab/document` and `/collab/presence` (the Nitro
runtime); see [Collaboration runtime routing](#collaboration-runtime-routing)
for how a document can instead be routed to the Cloudflare Durable Objects
runtime.

The server-only E2E seed endpoint is disabled by default. It activates only
when `E2E_ALLOW_REMOTE_SEED=true`, the supplied project ref exactly matches the
Supabase URL, a distinct production ref is configured, and a service-role key
plus bearer secret are present. Never enable it against production.

### WebSocket routing

Production routing is owned by the root [`vercel.json`](../../vercel.json)
Services configuration:

```text
/collab/** → apps/collab
/**        → apps/web
```

Stock Next.js 16.3 local `next dev` does not provide a release-equivalent
external WebSocket path for `/collab/*`. Playwright starts
`scripts/e2e-collab-router.mjs` in front of `next dev` so core E2E can exercise
same-origin `/collab/document` and `/collab/presence` locally. That router is
still not a Vercel Preview substitute.

Before promoting a deployment, verify a real Vercel Preview handshake through
`/collab/document`, Origin rejection for unknown sites, reconnect, and
repair/resync. Also configure a Vercel Firewall rate limit for `/collab/*`.
See [Vercel WebSockets](https://vercel.com/docs/functions/websockets) and
[Vercel Services](https://vercel.com/docs/services).

Keys and URL must belong to the **same** Supabase project. Never put a
`sb_secret_…` / `service_role` key in these `NEXT_PUBLIC_*` variables.

### Collaboration runtime routing

`resolveCollabRuntime` in
[`modules/docs/collab-runtime-routing.ts`](./modules/docs/collab-runtime-routing.ts)
picks, per document and on the server before the page renders, whether the
browser connects to the existing Nitro+Redis runtime (`apps/collab`) or the
Cloudflare Durable Objects runtime (`apps/collab-cloudflare`). Both runtimes
read and write the same Supabase tables, so switching a document back and
forth is reversible with no document-history migration.

| Variable | Effect |
| --- | --- |
| `NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL` | Base WS URL for the deployed Cloudflare worker (e.g. `wss://softmaple-collab-cloudflare.<subdomain>.workers.dev`). **Unset by default** — until this is set, every document stays on Nitro regardless of the other variables below. |
| `COLLAB_CLOUDFLARE_ROLLOUT_PERCENT` | `0`-`100`. Percentage of documents deterministically bucketed onto Cloudflare by a stable hash of the document id. Defaults to `0`. |
| `COLLAB_RUNTIME_OVERRIDE` | `nitro` or `cloudflare`. Global override applied to any document not on the allow/deny list below — used to test Cloudflare in an internal/preview environment (Stage 1-2), or as an instant rollback lever. |
| `COLLAB_CLOUDFLARE_DOCUMENT_ALLOWLIST` | Comma-separated document ids always routed to Cloudflare, regardless of percent/override. |
| `COLLAB_CLOUDFLARE_DOCUMENT_DENYLIST` | Comma-separated document ids always routed to Nitro. Takes precedence over the allowlist — the strongest per-document rollback lever. |

The decision is a pure function of `(documentId, config)`, so a given
document always resolves to the same runtime for a stable config, and both
its document and presence WebSocket connections use that same answer —
no document is ever split across both runtimes at once.

Rolling back is changing `COLLAB_RUNTIME_OVERRIDE`/`COLLAB_CLOUDFLARE_ROLLOUT_PERCENT`
back to their safe defaults (or clearing `NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL`
entirely) and redeploying — no data migration is involved. Deploying
`apps/collab-cloudflare` itself (secrets, `wrangler deploy`, DNS) is a
separate operational step; see [`apps/collab-cloudflare/README.md`](../collab-cloudflare/README.md).

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
├── scripts/             # Local E2E collab router
└── e2e/                 # Playwright specs
```
