# Supabase database setup

Prisma migrations are the source of truth for tables, Supabase Auth triggers,
RLS policies, and Data API grants. Deploy them with:

```bash
pnpm --filter @softmaple/db db:deploy
```

The remaining `cron/` and `scripts/` files are optional operational helpers;
they are not part of application schema deployment.
