# Supabase database setup

Prisma migrations are the source of truth for tables, Supabase Auth triggers,
RLS policies, and Data API grants. Deploy them with:

```bash
pnpm --filter @softmaple/db db:deploy
pnpm --filter @softmaple/db db:verify:collab-security
pnpm --filter @softmaple/db db:verify:core-behavior
```

The former `functions/`, `rls/`, and `triggers/` directories were removed
because they were manually ordered SQL fragments outside the migration ledger.
Their active definitions were consolidated into
[the secure Supabase Data API migration](../prisma/migrations/20260808200000_secure_supabase_data_api/migration.sql), so
the database functions, policies, and triggers themselves were not removed.
Later changes must be added as forward Prisma migrations instead of editing an
already-deployed migration or recreating a second schema source of truth.

The remaining `cron/` and `scripts/` files are optional operational helpers;
they are not part of application schema deployment.

`db:verify:collab-security` checks deployed structure and grants.
`db:verify:core-behavior` is for an isolated test project: it exercises the
Owner/Editor/Viewer/outsider/anonymous access matrix and avatar directory
policies inside a transaction that always rolls back.
