# `@softmaple/web`

Next.js 16 app router host for Softmaple: auth, workspaces, document UI, and
the Lexical editor. Real-time collaboration goes over WebSocket to
[`apps/collab`](../collab/README.md); this app does not write
`document_event_batches` itself.

## Role in the stack

```text
Browser ──► apps/web (Next.js)
              ├── Supabase Auth / Data API (anon / publishable key)
              └── WebSocket ──► apps/collab ──► Supabase Postgres
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
| `NEXT_PUBLIC_COLLAB_WS_URL` | yes (local collab) | Default `ws://localhost:3002/document` |

\*Required unless `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set.

`NEXT_PUBLIC_*` values are inlined at **build** time. After changing them in
Vercel (or any host), redeploy — restarting the running server is not enough.

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
pnpm --filter @softmaple/web build
```

## Layout

```text
apps/web/
├── app/                 # App Router pages, server actions, API routes
├── modules/             # Feature UI (auth, docs, workspaces, settings)
├── components/          # Shared UI
├── utils/supabase/      # Browser / server / middleware clients + config
└── e2e/                 # Playwright specs
```

## Auth / login troubleshooting

Login calls Supabase Auth via a server action
(`app/actions/auth.ts` → `signInWithPassword`).

| Symptom | Likely cause |
| --- | --- |
| `AuthApiError: Invalid API key` (401) | Wrong, truncated, or mismatched key; publishable key set to a bad value (it wins over `ANON_KEY`); legacy `anon` key disabled in the dashboard while still configured; host env not updated after key rename |
| Missing-config throw from `resolveSupabasePublicConfig` | Neither publishable nor anon key is set |
| Collab connects fail after login | `NEXT_PUBLIC_COLLAB_WS_URL` / `apps/collab` env mismatch — see [`apps/collab/README.md`](../collab/README.md) |

Fix checklist for `Invalid API key`:

1. In Supabase **Settings → API Keys**, copy the **Publishable** key
   (`sb_publishable_…`) or a still-enabled legacy **anon** JWT.
2. Set `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (and matching
   `NEXT_PUBLIC_SUPABASE_URL`) in the deployment environment.
3. If a stale/wrong publishable value is present, remove it or replace it —
   an invalid publishable key is preferred over a valid anon fallback.
4. Redeploy so Next.js rebuilds with the new `NEXT_PUBLIC_*` values.

## Related docs

- [Development setup](../../docs/development.mdx)
- [Quickstart](../../docs/quickstart.mdx)
- [Collaboration service](../collab/README.md)
- [Supabase DB / security](../../packages/db/supabase/README.md)
