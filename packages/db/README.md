# `@softmaple/db`

Prisma schema, migrations, and generated types for Supabase Postgres.
This package is the schema source of truth for tables, RLS, Auth triggers,
and Data API grants.

```bash
pnpm --filter @softmaple/db db:generate
pnpm --filter @softmaple/db db:migrate
pnpm --filter @softmaple/db db:deploy
pnpm --filter @softmaple/db db:verify:collab-security
```

Copy [`.env.example`](./.env.example) to `.env`. Use a pooled `DATABASE_URL`
for runtime and a direct `DIRECT_URL` for Prisma migrate.

Operational notes: [`supabase/README.md`](./supabase/README.md).
