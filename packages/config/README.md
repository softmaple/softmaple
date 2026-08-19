# `@softmaple/config`

Canonical site constants — public URLs, the docs and playground hosts, the
contact address, and the OpenGraph image. One `as const` object, imported
directly as TypeScript source, so a domain change is a one-line edit rather than
a grep across every app.

This package holds **public** values only. Nothing here is a secret: it is
inlined into client bundles by design.

## Role in the stack

```text
              apps/web                    packages/editor
      metadata · auth redirects      docs / playground links
         footers · OpenGraph           in the editor chrome
                  │                              │
                  └───────────────┬──────────────┘
                                  │
                          @softmaple/config
                                  │
                  ┌───────────────┴──────────────┐
                  │                              │
             SITE_CONFIG                 OPENGRAPH_IMAGE_URL
       DOCS · PLAYGROUND · DOMAIN         social card asset
    WEBSITE_URL · GITHUB_REPO · …
```

Consumed as source (`main` and `types` both point at `site.ts`), so there is no
build step and no `dist/` to keep in sync.

## Usage

```ts
import { SITE_CONFIG, OPENGRAPH_IMAGE_URL, type SiteConfig } from "@softmaple/config";

const docsHref = SITE_CONFIG.DOCS;
```

| Key | Purpose |
| --- | --- |
| `DOCS` | Mintlify documentation site |
| `PLAYGROUND` | Hosted `apps/playground` |
| `WEBSITE_URL` | Canonical marketing / app origin |
| `DOMAIN` | Bare apex domain |
| `GITHUB_REPO` | Repository URL |
| `TWITTER` | Project account |
| `CONTACT_EMAIL` | Public contact address |

`SITE_CONFIG` is `as const`, so `SiteConfig` gives each key a readonly literal
type and a typo fails at compile time instead of shipping a dead link. That is
a type-level guarantee only — `as const` does not call `Object.freeze`, so the
object is not frozen at runtime.

## What does not belong here

- Anything secret — API keys, service-role tokens, connection strings. Those
  live in environment variables, and the ones that reach the browser are
  documented per app (see [`apps/web/README.md`](../../apps/web/README.md)).
- Per-environment values. This file is the same in dev, preview, and
  production; anything that differs between them is an env var.
- Feature flags and rollout switches. Collaboration runtime routing, for
  example, is configured through environment variables in `apps/web`.

## Commands

```bash
pnpm --filter @softmaple/config lint
```
