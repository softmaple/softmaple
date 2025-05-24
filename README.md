> ⚠️ **Under Construction**

> For the old version, please check out the repo: [Eorg](https://github.com/zhyd1997/Eorg).
> For `v1` of SoftMaple, please check out the `main` branch.

![logo](https://ik.imagekit.io/1winv85cn8g/SoftMaple/logo.png)

<p>
  <a href=".github/CONTRIBUTING.md#pull-requests"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://discord.gg/Xzje2VAcdf"><img src="https://img.shields.io/discord/922309919158456330.svg" alt="Discord Chat" /></a>
  <a href= "https://github.com/prettier/prettier"><img alt="code style: prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg"></a>
  <a href="#license"><img src="https://img.shields.io/github/license/softmaple/softmaple.svg"></a>
  <a href="https://gitpod.io/#https://github.com/softmaple/softmaple"><img src="https://img.shields.io/badge/Gitpod-Ready--to--Code-blue?logo=gitpod" alt="Gitpod Ready-to-Code"/></a>
</p>

<a href="https://www.producthunt.com/posts/softmaple-editor?utm_source=badge-featured&utm_medium=badge&utm_souce=badge-softmaple-editor" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=325437&theme=light" alt="SoftMaple Editor - Write papers like MS Word and generate LaTeX for typesetting | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

## Star History

<a href="https://star-history.com/#softmaple/softmaple&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=softmaple/softmaple&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=softmaple/softmaple&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=softmaple/softmaple&type=Date" />
 </picture>
</a>

# shadcn/ui monorepo template

This template is for creating a monorepo with shadcn/ui.

## Usage

```bash
pnpm dlx shadcn@latest init
```

## Adding components

To add components to your app, run the following command at the root of your `web` app:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

This will place the ui components in the `packages/ui/src/components` directory.

## Tailwind

Your `tailwind.config.ts` and `globals.css` are already set up to use the components from the `ui` package.

## Using components

To use the components in your app, import them from the `ui` package.

```tsx
import { Button } from "@softmaple/ui/components/button"
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

