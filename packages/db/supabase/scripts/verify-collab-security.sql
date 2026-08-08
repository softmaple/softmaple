-- Read-only post-deploy assertions for collaboration persistence and RLS.
-- Any failed invariant raises an exception and makes `prisma db execute` fail.
DO $$
DECLARE
    missing_migrations TEXT;
    missing_private_policies TEXT;
BEGIN
    WITH expected(migration_name) AS (
        VALUES
            ('20260808230000_create_collab_composite_unique_index'),
            ('20260808230100_add_collab_composite_fk_not_valid'),
            ('20260808230200_validate_collab_composite_fk'),
            ('20260808230300_harden_auth_profile_trigger'),
            ('20260808230400_fix_workspace_owner_membership_rls')
    )
    SELECT string_agg(expected.migration_name, ', ' ORDER BY migration_name)
    INTO missing_migrations
    FROM expected
    WHERE NOT EXISTS (
        SELECT 1
        FROM public._prisma_migrations AS migration
        WHERE migration.migration_name = expected.migration_name
          AND migration.finished_at IS NOT NULL
          AND migration.rolled_back_at IS NULL
    );

    IF missing_migrations IS NOT NULL THEN
        RAISE EXCEPTION
            'collaboration migrations are not applied: %',
            missing_migrations;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_index AS index_state
        WHERE index_state.indexrelid = to_regclass(
                  'public.document_event_batches_id_document_id_key'
              )
          AND index_state.indrelid =
              'public.document_event_batches'::regclass
          AND index_state.indisunique
          AND index_state.indisready
          AND index_state.indisvalid
    ) THEN
        RAISE EXCEPTION
            'collaboration composite unique index is missing or invalid';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint AS constraint_state
        WHERE constraint_state.conname =
              'document_event_ids_batch_row_id_document_id_fkey'
          AND constraint_state.conrelid =
              'public.document_event_ids'::regclass
          AND constraint_state.confrelid =
              'public.document_event_batches'::regclass
          AND constraint_state.contype = 'f'
          AND constraint_state.convalidated
          AND constraint_state.confdeltype = 'c'
          AND constraint_state.confupdtype = 'c'
    ) THEN
        RAISE EXCEPTION
            'collaboration composite foreign key is missing or invalid';
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

    WITH expected(table_name, policy_name) AS (
        VALUES
            ('workspaces', 'workspaces_select_member'),
            ('workspaces', 'workspaces_update_owner'),
            ('workspaces', 'workspaces_delete_owner'),
            ('workspace_members', 'workspace_members_select_member'),
            ('workspace_members', 'workspace_members_insert_owner'),
            ('workspace_members', 'workspace_members_update_owner'),
            ('workspace_members', 'workspace_members_delete_owner'),
            ('documents', 'documents_select_visible'),
            ('documents', 'documents_insert_editor'),
            ('documents', 'documents_update_editor'),
            ('documents', 'documents_delete_author_or_owner'),
            ('document_versions', 'document_versions_select_member'),
            ('document_versions', 'document_versions_insert_editor')
    )
    SELECT string_agg(
        expected.table_name || '.' || expected.policy_name,
        ', ' ORDER BY expected.table_name, expected.policy_name
    )
    INTO missing_private_policies
    FROM expected
    LEFT JOIN pg_policies AS policy
      ON policy.schemaname = 'public'
     AND policy.tablename = expected.table_name
     AND policy.policyname = expected.policy_name
     AND (
         COALESCE(policy.qual, '') || COALESCE(policy.with_check, '')
     ) LIKE '%private.%'
    WHERE policy.policyname IS NULL;

    IF missing_private_policies IS NOT NULL THEN
        RAISE EXCEPTION
            'RLS policies missing private helpers: %',
            missing_private_policies;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (
            VALUES ('anon'), ('authenticated')
        ) AS api_roles(role_name)
        CROSS JOIN (
            VALUES
                ('public.document_event_batches'),
                ('public.document_event_ids')
        ) AS event_tables(table_name)
        CROSS JOIN (
            VALUES
                ('SELECT'),
                ('INSERT'),
                ('UPDATE'),
                ('DELETE'),
                ('REFERENCES'),
                ('TRUNCATE')
        ) AS privileges(privilege_name)
        WHERE has_table_privilege(
            api_roles.role_name::name,
            event_tables.table_name,
            privileges.privilege_name
        )
    ) THEN
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
              'trg_workspaces_create_owner_member',
              'trg_workspace_members_insert',
              'trg_workspace_members_update',
              'trg_document_versions_insert',
              'trg_document_versions_update',
              'trg_users_insert',
              'trg_users_update'
          )
    ) <> 12 THEN
        RAISE EXCEPTION 'an application trigger is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname = 'trg_workspaces_create_owner_member'
          AND tgrelid = 'public.workspaces'::regclass
          AND tgfoid = to_regprocedure(
              'private.create_owner_workspace_member()'
          )
    ) THEN
        RAISE EXCEPTION
            'trg_workspaces_create_owner_member is missing or miswired on public.workspaces';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'workspace_members'
          AND policyname = 'workspace_members_select_member'
          AND COALESCE(qual, '') ~
              'user_id[[:space:]]*=[[:space:]]*\([[:space:]]*SELECT[[:space:]]+auth\.uid\(\)'
    ) THEN
        RAISE EXCEPTION
            'workspace_members SELECT policy does not allow self-read';
    END IF;
END;
$$;
