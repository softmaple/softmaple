> ⚠️ **Under Construction**

> For the old version, please check out the repo: [Eorg](https://github.com/zhyd1997/Eorg).
>
> For `v1` of SoftMaple, please check out the `main` branch.

![landing hero section](https://ik.imagekit.io/1winv85cn8g/SoftMaple/landing@2x_OjkYtqPwZ.png?updatedAt=1749375184240)

<p>
  <a href=".github/CONTRIBUTING.md#pull-requests"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://discord.gg/Vwsuqq7dQD"><img src="https://img.shields.io/discord/922309919158456330.svg" alt="Discord Chat" /></a>
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

# 📝 SoftMaple - A Paper Typesetting Editor

SoftMaple is a collaborative paper typesetting editor built with modern web technologies. Experience it at [softmaple.ink](https://softmaple.ink).

## 🚀 Features

- **Real-time Collaboration** - Powered by Liveblocks for seamless multi-user editing
- **Rich Text Editing** - Built with Lexical for a powerful editing experience
- **LaTeX Support** - Convert Markdown to LaTeX with built-in converter
- **Modern Stack** - Next.js 16, React 19, TypeScript, and Tailwind CSS v4
- **Database & Auth** - Supabase for authentication and data persistence

## 📚 Documentation

Visit our documentation sites:
- [Main Documentation](https://softmaple.ink)
- [Blog](https://blog.softmaple.ink)
- [Developer Insights](https://insights.softmaple.ink)

## 🏗️ Architecture

Built with [Turborepo](https://turborepo.org/) monorepo structure:

- apps
  - **[web](apps/web)** - Main Next.js 16 application with App Router

- packages
  - **[config](packages/config)** - Shared configuration
  - **[db](packages/db)** - Prisma ORM and database schema
  - **[editor](packages/editor)** - Lexical-based rich text editor
  - **[md2latex](packages/md2latex)** - Markdown to LaTeX converter
  - **[ui](packages/ui)** - Shared component library (shadcn/ui)
  - **[eslint-config](packages/eslint-config)** - ESLint presets
  - **[typescript-config](packages/typescript-config)** - TypeScript configs

- docs
  - **[Mintlify Documentation](docs)** - Project documentation

## 🛠️ Development

### Prerequisites

- Node.js >= 24
- pnpm 10.23.0 ([installation guide](https://pnpm.io/installation))

### Quick Start

```bash
# Clone the repository
git clone https://github.com/softmaple/softmaple.git
cd softmaple

# Install dependencies
pnpm install

# Set up environment variables
cp apps/web/.env.example apps/web/.env
# Add your LIVEBLOCKS_SECRET_KEY and other required vars

# Start development server
pnpm dev
```

### Key Commands

- `pnpm dev` - Start development servers (Turbopack)
- `pnpm build` - Build all workspaces
- `pnpm lint` - Run ESLint across all packages
- `pnpm format` - Format code with Prettier
- `pnpm --filter @softmaple/web test:e2e` - Run E2E tests

For more detailed commands, see [AGENTS.md](AGENTS.md).

## 👥 Community

Join our community:
- [GitHub Discussions](https://github.com/softmaple/softmaple/discussions) - Ask questions and share ideas
- [Discord Server](https://discord.gg/Vwsuqq7dQD) - Chat with other community members

Our [Code of Conduct](.github/CODE_OF_CONDUCT.md) applies to all SoftMaple community channels.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](.github/CONTRIBUTING.md) and [Repository Guidelines](AGENTS.md) for development practices.

### Commit Convention

We use conventional commits: `type(scope): summary`
- Example: `fix(apps/web): resolve auth token issue`
- Example: `feat(packages/editor): add table support`

## 📄 License

[Apache-2.0 License](LICENSE)

## 🙏 Special Thanks

[![Deploys by Netlify](https://www.netlify.com/v3/img/components/netlify-color-accent.svg)](https://www.netlify.com?utm_source=SoftMaple&utm_campaign=oss)

[![BrowserStack](https://d2ogrdw2mh0rsl.cloudfront.net/production/images/static/header/header-logo.svg)](https://www.browserstack.com/)

[Devin AI](https://devin.ai/) _$500 grants_

[![Made with Prisma](https://made-with.prisma.io/dark.svg)](https://prisma.io)
