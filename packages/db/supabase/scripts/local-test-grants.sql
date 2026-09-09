-- Local harness only. New CLI defaults revoke service-role DML on new tables;
-- the existing seed endpoint uses this server-only role to create test fixtures.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.users, public.workspaces, public.workspace_members, public.documents
  TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
