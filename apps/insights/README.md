# github-insights-view

## Set up environment variables
```bash
cp .env.local.example .env.local
```

## Development
```bash
# install dependencies
pnpm install
# start mongodb (macoOS)
brew services start mongodb-community@5.0
## before quit
# brew services stop mongodb-community@5.0
# start app
pnpm dev
```
