-- Clean all tables except migrations
-- This script removes all data but preserves the schema
-- Compatible with Supabase (no superuser privileges required)

-- Get all table names except migration tables and truncate them
DO $$ 
DECLARE 
    r RECORD;
BEGIN
    -- Loop through all tables in public schema except _prisma_migrations
    FOR r IN 
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' 
        AND tablename != '_prisma_migrations'
    LOOP
        -- Use CASCADE to handle foreign key dependencies and RESTART IDENTITY to reset sequences
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
    END LOOP;
END $$;
