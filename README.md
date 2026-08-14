# Softmaple

A collaborative paper typesetting editor: Lexical rich text, EG-walker
convergence, Markdown → $\LaTeX$, and durable history in Supabase Postgres.

Development happens on the `next` branch. The previous product lives on
[`main`](https://github.com/softmaple/softmaple/tree/main). The original
prototype is [Eorg](https://github.com/zhyd1997/Eorg).

![landing hero section](https://ik.imagekit.io/1winv85cn8g/SoftMaple/landing@2x_OjkYtqPwZ.png?updatedAt=1749375184240)

<p>
  <a href=".github/CONTRIBUTING.md#pull-requests"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://discord.gg/Vwsuqq7dQD"><img src="https://img.shields.io/discord/922309919158456330.svg" alt="Discord Chat" /></a>
  <a href="https://biomejs.dev/"><img alt="Formatted with Biome" src="https://img.shields.io/badge/Formatted_with-Biome-60a5fa?style=flat&logo=biome"></a>
  <a href="#license"><img src="https://img.shields.io/github/license/softmaple/softmaple.svg"></a>
  <a href="https://app.ona.com/#https://github.com/softmaple/softmaple"><img src="https://ona.com/build-with-ona.svg" alt="Build with Ona"/></a>
</p>

## Star History

<a href="https://star-history.com/#softmaple/softmaple&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=softmaple/softmaple&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=softmaple/softmaple&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=softmaple/softmaple&type=Date" />
 </picture>
</a>

# Architecture

Turborepo monorepo. The product host is Next.js; collaboration is a separate
WebSocket runtime (Nitro by default, Cloudflare Durable Objects as an optional
rollout).

## Apps

- [web](apps/web) — Next.js 16 app router: auth, workspaces, document UI
  - **Supabase Auth** and the Supabase Data API
  - Same-origin `/collab/*` to [`apps/collab`](apps/collab) by default
  - Optional per-document routing to [`apps/collab-cloudflare`](apps/collab-cloudflare)
- [collab](apps/collab) — Nitro WebSocket service (default collaboration runtime)
  - Persists EG-walker batches to **Supabase Postgres**
  - Redis for multi-instance fan-out, presence TTLs, and connection leases
- [collab-cloudflare](apps/collab-cloudflare) — Cloudflare Workers + Durable Objects
  - Same `@softmaple/collab-runtime` semantics; Durable Object-local fan-out
- [playground](apps/playground) — TanStack Start demos for EG-walker, Lexical,
  awareness, and WebSocket rooms

## Packages

- [awareness](packages/awareness) — Presence UI and transport-agnostic protocol
- [bench](packages/bench) — EG-walker performance harnesses
- [binding-lexical](packages/binding-lexical) — Lexical ↔ block-model binding
- [block-model](packages/block-model) — Editor-agnostic rich-text CRDT model
- [collab-protocol](packages/collab-protocol) — Authenticated collaboration wire protocol
- [collab-runtime](packages/collab-runtime) — Host-independent document and presence rooms
- [config](packages/config) — Shared site URLs and constants
- [db](packages/db) — Prisma schema, migrations, and Supabase helpers
- [editor](packages/editor) — Lexical editor, React 19, Vite, Tailwind CSS v4
- [eg-walker](packages/eg-walker) — Sequence-model EG-walker engine
- [eslint-config](packages/eslint-config) — Shared ESLint configuration
- [md2latex](packages/md2latex) — Markdown to $\LaTeX$ converter
- [typescript-config](packages/typescript-config) — Shared TypeScript `tsconfig.json`
- [ui](packages/ui) — Shared React component library (shadcn/ui)

## Docs

- [docs](docs) — Mintlify documentation at [docs.softmaple.ink](https://docs.softmaple.ink)

# Development

Requires **Node.js 24.12+** and **pnpm 11**. See
[Development](docs/development.mdx) for environment variables and the
same-origin WebSocket path.

```bash
pnpm install
cp apps/web/.env.example apps/web/.env
cp apps/collab/.env.example apps/collab/.env.local
cp packages/db/.env.example packages/db/.env
pnpm --filter @softmaple/db db:generate
pnpm --filter @softmaple/db db:migrate
pnpm dev
```

`pnpm dev` starts `apps/web` and `apps/collab` through Turborepo. Stock
`next dev` does not forward `/collab/*` WebSocket upgrades; use the Playwright
router or `vercel dev` from the repository root. See
[apps/web/README.md](apps/web/README.md).

# Community

The Softmaple community is on [GitHub Discussions](https://github.com/softmaple/softmaple/discussions)
and [Discord](https://discord.gg/Vwsuqq7dQD).

Our [Code of Conduct](.github/CODE_OF_CONDUCT.md) applies to all community channels.

# Contributing

See [Contributing Guidelines](.github/CONTRIBUTING.md).

# License

[Apache-2.0 License](LICENSE)

# Special thanks

[![BrowserStack](https://d2ogrdw2mh0rsl.cloudfront.net/production/images/static/header/header-logo.svg)](https://www.browserstack.com/)

[Devin AI](https://devin.ai/) _$500 grants_
