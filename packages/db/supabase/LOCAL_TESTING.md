# Isolated browser verification

Start Docker, then create a loopback-bound network once:

```sh
docker network create -o 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1' softmaple-local
```

From the repository root:

```sh
node apps/web/scripts/local-e2e.mjs
```

The pinned CLI in this package starts `softmaple-redesign`, obtains local keys
without writing them to tracked files, applies the existing Prisma migration
history, and runs the real Next/Nitro/Playwright stack. CLI arguments after the
script are forwarded to Playwright (for example `--grep presence`). No remote
project is linked or migrated. Ports 54320–54324 and 32110–32112 must be free.

The seed route still requires a random server-side secret. Local seeding also
requires development mode, an explicit local flag, a loopback request URL and a
loopback Supabase URL. Production and existing remote seed safeguards remain.

Stop the local stack without deleting its data:

```sh
pnpm --filter @softmaple/db exec supabase stop
```
