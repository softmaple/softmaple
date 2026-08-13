# `@softmaple/web`

Next.js 16 app router host for Softmaple: auth, workspaces, document UI, and
the Lexical editor. By default, realtime collaboration uses same-origin
WebSocket paths routed to [`apps/collab`](../collab/README.md);
Cloudflare-selected documents connect directly to the configured Worker. This
app does not write `document_event_batches` or proxy WebSocket upgrades.

## Role in the stack

The default Nitro path is:

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
| Durable event persistence / realtime fan-out | [`apps/collab`](../collab/README.md) (Prisma + Redis) or [`apps/collab-cloudflare`](../collab-cloudflare/README.md) (Supabase RPC + DO-local fan-out) |
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

Same-origin Nitro WebSocket routing is owned by the root
[`vercel.json`](../../vercel.json) Services configuration. Cloudflare-selected
documents bypass this mapping and use the configured Worker URL directly:

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
Cloudflare Durable Objects runtime (`apps/collab-cloudflare`). Both document
runtimes read and write the same Supabase event-history tables, so switching a
document back and forth needs no document-history migration. Live presence is
runtime-local and is recreated when the client joins the destination runtime.

| Variable | Effect |
| --- | --- |
| `NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL` | Base WS URL for the deployed Cloudflare worker (e.g. `wss://softmaple-collab-cloudflare.<subdomain>.workers.dev`). **Unset by default** — until this is set, every document stays on Nitro regardless of the other variables below. |
| `COLLAB_CLOUDFLARE_ROLLOUT_PERCENT` | `0`-`100`. Percentage of documents deterministically bucketed onto Cloudflare by a stable hash of the document id. Defaults to `0`. |
| `COLLAB_RUNTIME_OVERRIDE` | `nitro` or `cloudflare`. Global override applied to any document not on the allow/deny list below — used to test Cloudflare in an internal/preview environment (Stage 1-2), or as a quick rollback lever for the percentage cohort. It does **not** move allow-listed documents: those stay on Cloudflare regardless of this variable, since the allowlist takes precedence. A complete rollback needs to also clear `COLLAB_CLOUDFLARE_DOCUMENT_ALLOWLIST` (or move the affected ids to `COLLAB_CLOUDFLARE_DOCUMENT_DENYLIST`), or clear `NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL` entirely. |
| `COLLAB_CLOUDFLARE_DOCUMENT_ALLOWLIST` | Comma-separated document ids always routed to Cloudflare, regardless of percent/override. |
| `COLLAB_CLOUDFLARE_DOCUMENT_DENYLIST` | Comma-separated document ids always routed to Nitro. Takes precedence over the allowlist — the strongest per-document rollback lever. |

The decision is a pure function of `(documentId, config)`, so a given
document always resolves to the same runtime for a stable config, and both
its document and presence WebSocket connections use that same answer for
any newly-rendered page load.

That guarantee applies at page-render time only, not to WebSockets a
browser already has open. `collabRuntime` is resolved once server-side and
baked into the live session (`useDocumentSession`). Automatic reconnect
reuses that value; only a newly rendered page (normally a reload or fresh
tab) can pick up changed routing config. Existing tabs therefore remain on
their original runtime until re-rendered. **Two tabs open on the same
document across a config change can be on different runtimes for as long
as the older page remains open** — potentially indefinitely. They receive
no live cross-runtime fan-out or shared presence. A reconnect can repair
durable history from shared Postgres but remains on the same runtime; only
a reload or fresh render transfers runtime ownership.

Because one document must not have concurrent runtime owners, treat that
split as a **correctness and dual-write incident**, not only a stale-tab UX
issue. Stop rollout expansion, identify affected document ids, and drain or
coordinate a reload of every old-runtime tab before declaring the handoff
complete; automatic reconnect is not sufficient. Prefer changing routing
only while no affected editor is connected. Before resuming, verify old
connections are gone, reloaded clients joined document and presence rooms
on the selected runtime, and durable repair completed. Test both a page
rendered before and one rendered after the change against the same
document.

Rolling back is changing `COLLAB_RUNTIME_OVERRIDE`/`COLLAB_CLOUDFLARE_ROLLOUT_PERCENT`
back to their safe defaults (or clearing `NEXT_PUBLIC_COLLAB_CLOUDFLARE_WS_URL`
entirely) and redeploying — no data migration is involved, but per above,
existing open tabs observe the rollback only after a reload or fresh server
render; automatic reconnect keeps their original runtime. Deploying
`apps/collab-cloudflare` itself (secrets, `wrangler deploy`, DNS) is a separate
operational step; see
[`apps/collab-cloudflare/README.md`](../collab-cloudflare/README.md).

For the cross-runtime picture — when to deploy which runtime, Supabase/
Redis/DO responsibilities, and the current default-runtime decision — see
[`docs/design/collaboration-operations.md`](../../docs/design/collaboration-operations.md).

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
