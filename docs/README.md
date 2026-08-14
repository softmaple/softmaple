# Softmaple documentation

Mintlify site for [docs.softmaple.ink](https://docs.softmaple.ink). Source
lives in this directory; navigation is [`docs.json`](./docs.json).

## Local preview

```bash
pnpm dlx mint dev
```

Run that from `docs/`. The preview is at [http://localhost:3000](http://localhost:3000).

## Contents

| Path | Purpose |
| --- | --- |
| `welcome.mdx`, `quickstart.mdx`, `development.mdx` | Getting started |
| `design/` | Collaboration architecture and operations |
| `blog/` | Long-form notes (for example EG-walker performance) |

Production publishes from the default branch through the Mintlify GitHub app.
