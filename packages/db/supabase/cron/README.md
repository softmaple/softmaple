# Supabase Cron Jobs

This directory contains SQL scripts for setting up cron jobs in Supabase.

## keepalive.sql

This script sets up a keep-alive cron job that runs `SELECT 1` every 5 minutes to prevent the database from going idle on free-tier Supabase.

### Prerequisites

1. Enable `pg_cron` extension in your Supabase Dashboard:
   - Go to Settings → Database → Extensions
   - Search for `pg_cron`
   - Enable it

### Running the Script

Execute this SQL directly in your Supabase SQL Editor or via CLI:

```bash
psql $DATABASE_URL -f packages/db/supabase/cron/keepalive.sql
```

### Verification

To verify the cron job is running:

```sql
SELECT * FROM cron.job WHERE jobname = 'database-keepalive';
```

### Removal

To remove the keep-alive job:

```sql
SELECT cron.unschedule('database-keepalive');
```

## Note

These scripts are **not** migrations and should be executed directly as administrative tasks.
