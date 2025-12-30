-- Enable pg_cron extension for scheduling jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage on cron schema to postgres
GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove existing keepalive job if it exists (makes this idempotent)
SELECT cron.unschedule('database-keepalive');

-- Schedule a simple keep-alive ping every 5 minutes
-- This prevents the database from going idle on free-tier Supabase
SELECT cron.schedule(
  'database-keepalive',  -- job name
  '*/5 * * * *',        -- every 5 minutes
  'SELECT 1;'           -- simple no-op query
);

-- Verify the job was created
SELECT jobname, schedule, active, command 
FROM cron.job 
WHERE jobname = 'database-keepalive';
