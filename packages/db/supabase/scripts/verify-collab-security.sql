-- Read-only post-deploy assertions for collaboration persistence and RLS.
-- Any failed invariant raises an exception and makes `prisma db execute` fail.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public._prisma_migrations
        WHERE migration_name = '20260808220000_harden_rls_helpers'
          AND finished_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'collaboration RLS migration is not applied';
    END IF;

    IF to_regprocedure('public.is_workspace_member(uuid,integer)') IS NOT NULL
       OR to_regprocedure('public.is_workspace_owner(uuid,integer)') IS NOT NULL
       OR to_regprocedure('public.can_edit_workspace(uuid,integer)') IS NOT NULL
    THEN
        RAISE EXCEPTION 'legacy public authorization helpers still exist';
    END IF;

    IF to_regprocedure('private.is_workspace_member(integer)') IS NULL
       OR to_regprocedure('private.is_workspace_owner(integer)') IS NULL
       OR to_regprocedure('private.can_edit_workspace(integer)') IS NULL
    THEN
        RAISE EXCEPTION 'private authorization helpers are incomplete';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (
              COALESCE(qual, '') || COALESCE(with_check, '')
          ) ~ 'public\.(is_workspace_member|is_workspace_owner|can_edit_workspace)'
    ) THEN
        RAISE EXCEPTION 'an RLS policy still uses a public authorization helper';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (
              COALESCE(qual, '') || COALESCE(with_check, '')
          ) LIKE '%private.%'
    ) < 13 THEN
        RAISE EXCEPTION 'RLS policies do not consistently use private helpers';
    END IF;

    IF has_table_privilege('anon', 'public.document_event_batches', 'SELECT')
       OR has_table_privilege(
           'authenticated',
           'public.document_event_batches',
           'INSERT'
       )
       OR has_table_privilege('anon', 'public.document_event_ids', 'SELECT')
       OR has_table_privilege(
           'authenticated',
           'public.document_event_ids',
           'INSERT'
       )
    THEN
        RAISE EXCEPTION 'collaboration event tables are exposed to Data API roles';
    END IF;

    IF NOT (
        SELECT bool_and(relrowsecurity)
        FROM pg_class
        WHERE oid IN (
            'public.users'::regclass,
            'public.workspaces'::regclass,
            'public.workspace_members'::regclass,
            'public.documents'::regclass,
            'public.document_versions'::regclass,
            'public.document_event_batches'::regclass,
            'public.document_event_ids'::regclass
        )
    ) THEN
        RAISE EXCEPTION 'RLS is disabled on a protected public table';
    END IF;

    IF to_regprocedure('public.handle_new_user()') IS NULL
       OR to_regprocedure('public.set_metadata_on_insert()') IS NULL
       OR to_regprocedure('public.set_metadata_on_update()') IS NULL
       OR to_regprocedure('public.set_user_full_name_and_metadata()') IS NULL
    THEN
        RAISE EXCEPTION 'an application trigger function is missing';
    END IF;

    IF (
        SELECT COUNT(*)
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN (
              'on_auth_user_created',
              'trg_documents_insert',
              'trg_documents_update',
              'trg_workspaces_insert',
              'trg_workspaces_update',
              'trg_workspace_members_insert',
              'trg_workspace_members_update',
              'trg_document_versions_insert',
              'trg_document_versions_update',
              'trg_users_insert',
              'trg_users_update'
          )
    ) <> 11 THEN
        RAISE EXCEPTION 'an application trigger is missing';
    END IF;
END;
$$;
