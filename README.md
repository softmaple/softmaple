> For old version, please check out the repo: [Eorg](https://github.com/zhyd1997/Eorg).

![logo](https://ik.imagekit.io/1winv85cn8g/SoftMaple/logo.png)

<p>
  <a href=".github/CONTRIBUTING.md#pull-requests"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://discord.gg/Xzje2VAcdf"><img src="https://img.shields.io/discord/922309919158456330.svg" alt="Discord Chat" /></a>
  <a href= "https://github.com/prettier/prettier"><img alt="code style: prettier" src="https://img.shields.io/badge/code_style-prettier-ff69b4.svg"></a>
  <a href="#license"><img src="https://img.shields.io/github/license/softmaple/softmaple.svg"></a>
  <a href="https://gitpod.io/#https://github.com/softmaple/softmaple"><img src="https://img.shields.io/badge/Gitpod-Ready--to--Code-blue?logo=gitpod" alt="Gitpod Ready-to-Code"/></a>
</p>

<a href="https://www.producthunt.com/posts/softmaple-editor?utm_source=badge-featured&utm_medium=badge&utm_souce=badge-softmaple-editor" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=325437&theme=light" alt="SoftMaple Editor - Write papers like MS Word and generate LaTeX for typesetting | Product Hunt" style="width: 250px; height: 54px;" width="250" height="54" /></a>

# Documentation

For details, check out our [documentation](https://docs.softmaple.ink/).

# Features

Using [draftjs-to-latex](https://github.com/zhyd1997/draftjs-to-latex) for generating LaTeX source code.

![ScreenShot](https://user-images.githubusercontent.com/31362988/148916265-29e058fb-9220-4d9b-9294-5f8d5279827c.gif)

# Issues and Pitfalls

See more details at here: https://draftjs.org/docs/advanced-topics-issues-and-pitfalls

# Development

[Turborepo](https://turborepo.org/) Architecture:

![architecture](https://ik.imagekit.io/1winv85cn8g/SoftMaple/turborepo-dev_Ck0RLxMI0.png)
 
- [docs](apps/docs) - built with [Docusaurus 2](https://github.com/facebook/docusaurus)

- apps
  - [Editor](apps/editor) (**core**) - Next.js with [Draftjs](https://github.com/facebook/draft-js)
  - [insights](apps/insights) (*deprecated*) - Next.js with [Echarts](https://github.com/apache/echarts)

- packages
  - [config](packages/config) - Shared configuration (ESLint)
  - [tsconfig](packages/tsconfig) - Shared TypeScript `tsconfig.json`
  - [ui](packages/ui) - Shared React component library

We use `pnpm` for package management, if you never used it, see [pnpm](https://pnpm.io/installation) for installation. 

```bash
pnpm install
pnpm dev
```

<details>
  <summary>What if I just want to check out <code>Editor</code> app source code?</summary>

  ```bash
  git clone --no-checkout https://github.com/softmaple/softmaple
  cd softmaple
  git sparse-checkout init --cone --sparse-index
  git sparse-checkout set apps/editor packages
  git checkout main
  ```

  Read more: [sparse-checkout](https://github.blog/2020-01-17-bring-your-monorepo-down-to-size-with-sparse-checkout/) and [sparse index](https://github.blog/2021-11-10-make-your-monorepo-feel-small-with-gits-sparse-index/).
</details>

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
