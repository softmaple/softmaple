> ⚠️ **Under Construction**

> For the old version, please check out the repo: [Eorg](https://github.com/zhyd1997/Eorg).
>
> For `v1` of SoftMaple, please check out the `main` branch.

![logo](https://ik.imagekit.io/1winv85cn8g/SoftMaple/logo.png)

<p>
  <a href=".github/CONTRIBUTING.md#pull-requests"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://discord.gg/Xzje2VAcdf"><img src="https://img.shields.io/discord/922309919158456330.svg" alt="Discord Chat" /></a>
  <a href= "https://github.com/prettier/prettier"><img alt="code style: prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg"></a>
  <a href="#license"><img src="https://img.shields.io/github/license/softmaple/softmaple.svg"></a>
  <a href="https://gitpod.io/#https://github.com/softmaple/softmaple"><img src="https://img.shields.io/badge/Gitpod-Ready--to--Code-blue?logo=gitpod" alt="Gitpod Ready-to-Code"/></a>
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

## shadcn/ui [turborepo](https://turborepo.org/) architecture:

- apps
    - [web](apps/web) - Main web application
      - **Next.js** v15 with `app` folder
      - **Liveblocks** for real-time collaboration
      - **Supabase** for database and authentication

- packages
    - [config](packages/config) - Site configuration
    - [db](packages/db) - Database schema and migrations
      - **Prisma** for ORM [![Made with Prisma](https://made-with.prisma.io/dark.svg)](https://prisma.io)
    - [editor](packages/editor) - Rich text editor
      - **Lexical** for rich text editing
      - **React** 19
      - **Vite**
    - [md2latex](packages/md2latex) - Markdown to $\LaTeX$ converter
    - [eslint-config](packages/eslint-config) - Shared ESLint configuration
    - [typescript-config](packages/typescript-config) - Shared TypeScript `tsconfig.json`
    - [ui](packages/ui) - Shared React component library
      - **shadcn/ui** for UI components
      - **Tailwind CSS** v4 for styling

We use `pnpm` for package management, if you never used it, see [pnpm](https://pnpm.io/installation) for installation.

```bash
pnpm install
pnpm dev
```

# Community
The SoftMaple community can be found on [GitHub Discussions](https://github.com/softmaple/softmaple/discussions), where you can ask questions and voice ideas.

To chat with other community members you can join the [SoftMaple Discord](https://discord.gg/Xzje2VAcdf).

Our [Code of Conduct](.github/CODE_OF_CONDUCT.md) applies to all SoftMaple community channels.

# Contributing

See [Contributing Guidelines](.github/CONTRIBUTING.md).

# License

[Apache-2.0 License](LICENSE)

# Special thanks

[![Deploys by Netlify](https://www.netlify.com/v3/img/components/netlify-color-accent.svg)](https://www.netlify.com?utm_source=SoftMaple&utm_campaign=oss)

[![BrowserStack](https://d2ogrdw2mh0rsl.cloudfront.net/production/images/static/header/header-logo.svg)](https://www.browserstack.com/)

[Devin AI](https://devin.ai/) _$500 grants_

