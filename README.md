> ⚠️ **Under Construction**

> For the old version, please check out the repo: [Eorg](https://github.com/zhyd1997/Eorg).
>
> For `v1` of SoftMaple, please check out the `main` branch.

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

# Development

## Architecture

Softmaple is a collaborative $\LaTeX$-flavoured document editor. Each layer
below is its own workspace package — here is the path a keystroke takes from
the browser to durable storage:

```text
                                Browser
                      apps/web · apps/playground
                                   │
         ┌─────────────────────────┼──────────────────────────────┐
         │                         │                              │
 @softmaple/editor    @softmaple/binding-lexical        @softmaple/awareness
 Lexical UI shell        Lexical ↔ block model           ephemeral presence
                                   │                              │
                        @softmaple/block-model                    │
                    blocks · marks · event batches                │
                                   │                              │
                         @softmaple/eg-walker                     │
                    event graph · CRDT convergence                │
                                   │                              │
                    RichTextEventBatch on the wire                │
                                   │                              │
                      @softmaple/collab-protocol                  │
                        versioned wire messages                   │
                                   │                              │
                       @softmaple/collab-runtime ──PresenceCodec──┘
                 DocumentRoom / PresenceRoom semantics
                      ┌────────────┴────────────┐
                      │                         │
                 Node/Nitro                Cloudflare
              apps/collab-nitro      apps/collab-cloudflare
                      │                         │
                    Redis                Durable Object
              pub/sub · leases          hibernatable room
                      │                         │
                      └────────────┬────────────┘
                                   │
                           Supabase/Postgres
                           durable event log
```

The import graph runs the same direction — a lower layer never imports a higher
one — and is enforced by shared ESLint rules
([`packages/eslint-config/collaboration-layers.js`](packages/eslint-config/collaboration-layers.js)).
`@softmaple/collab-protocol` reaches the block model, not EG-walker directly;
it only carries the batches the model produces.

Awareness stays independent of every convergent document model and meets the
bindings only inside an app. `@softmaple/collab-runtime` hosts `PresenceRoom`
but never imports `@softmaple/awareness` — the labelled edge above is the
payload-opaque `PresenceCodec` seam, and a host app is what binds the two.

Both collaboration runtimes host the *same* `@softmaple/collab-runtime`
semantics and write the same Postgres event log, so a document can move between
them without a history migration.

Design source of truth:
[`docs/design/collaboration-layers.md`](docs/design/collaboration-layers.md) ·
[`collaboration-consistency.md`](docs/design/collaboration-consistency.md) ·
[`collaboration-runtime.md`](docs/design/collaboration-runtime.md) ·
[`collaboration-operations.md`](docs/design/collaboration-operations.md).

## shadcn/ui [turborepo](https://turborepo.org/) architecture:

- apps
  - [web](apps/web) - Main web application
    - **Next.js** v16 with `app` folder
    - **EG-walker + WebSocket** for real-time collaboration
    - **Supabase Postgres** for durable history and **Supabase Auth** for authentication
  - [collab-cloudflare](apps/collab-cloudflare) - Collaboration runtime on Cloudflare (recommended for production)
    - **Workers + Durable Objects** with WebSocket Hibernation
    - **Supabase RPC** for durable appends, DO-local fan-out
  - [collab-nitro](apps/collab-nitro) - Collaboration runtime on Nitro (local dev / fallback)
    - **Nitro** WebSocket service behind Vercel Services
    - **Redis** for realtime fan-out, presence TTLs, and connection leases
  - [playground](apps/playground) - Collaboration and editor demo surface
    - **TanStack Start** + **Vite**, wired straight to the workspace sources

- packages
  - [awareness](packages/awareness) - Presence and awareness layer
    - **Transport-agnostic** adapters (WebSocket, BroadcastChannel, no-op)
    - Cursors, selections, avatars, and activity indicators
  - [bench](packages/bench) - Performance harnesses for `@softmaple/eg-walker`
  - [binding-lexical](packages/binding-lexical) - Lexical ↔ block model binding
  - [block-model](packages/block-model) - Editor-agnostic rich-text block model
  - [collab-protocol](packages/collab-protocol) - Versioned collaboration wire protocol
  - [collab-runtime](packages/collab-runtime) - Host-independent room and session semantics
  - [config](packages/config) - Site configuration
  - [db](packages/db) - Database schema and migrations
    - **Prisma** for ORM [![Made with Prisma](https://made-with.prisma.io/dark.svg)](https://prisma.io)
    - **Supabase** self-hosted guide
  - [editor](packages/editor) - Rich text editor
    - **Lexical** for rich text editing
    - **React** 19 and **Vite**
  - [eg-walker](packages/eg-walker) - EG-walker CRDT for collaborative editing
  - [md2latex](packages/md2latex) - Markdown to $\LaTeX$ converter
  - [eslint-config](packages/eslint-config) - Shared ESLint configuration
  - [typescript-config](packages/typescript-config) - Shared TypeScript `tsconfig.json`
  - [ui](packages/ui) - Shared React component library
    - **shadcn/ui** for UI components
    - **Tailwind CSS** v4 for styling

- docs
  - [docs](docs) - **Mintlify Documentation** - Project documentation

We use `pnpm` for package management, if you never used it, see [pnpm](https://pnpm.io/installation) for installation.

```bash
pnpm install
pnpm dev
```

# Community

The SoftMaple community can be found on [GitHub Discussions](https://github.com/softmaple/softmaple/discussions), where you can ask questions and voice ideas.

To chat with other community members you can join the [SoftMaple Discord](https://discord.gg/Vwsuqq7dQD).

Our [Code of Conduct](.github/CODE_OF_CONDUCT.md) applies to all SoftMaple community channels.

# Contributing

See [Contributing Guidelines](.github/CONTRIBUTING.md).

# License

[Apache-2.0 License](LICENSE)

# Special thanks

[![Deploys by Netlify](https://www.netlify.com/v3/img/components/netlify-color-accent.svg)](https://www.netlify.com?utm_source=SoftMaple&utm_campaign=oss)

[![BrowserStack](https://d2ogrdw2mh0rsl.cloudfront.net/production/images/static/header/header-logo.svg)](https://www.browserstack.com/)

[Devin AI](https://devin.ai/) _$500 grants_
