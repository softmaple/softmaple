-- Read-only post-deploy assertions for Softmaple core v1.
-- Any failed invariant raises and makes `prisma db execute` fail.
DO $$
DECLARE
    missing_migrations TEXT;
    missing_policies TEXT;
BEGIN
    WITH expected(migration_name) AS (
        VALUES
            ('20260808230000_create_collab_composite_unique_index'),
            ('20260808230100_add_collab_composite_fk_not_valid'),
            ('20260808230200_validate_collab_composite_fk'),
            ('20260808230300_harden_auth_profile_trigger'),
            ('20260808230400_fix_workspace_owner_membership_rls'),
            ('20260809000000_core_v1'),
            ('20260811043830_add_cloudflare_collab_rpc')
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
        RAISE EXCEPTION 'core migrations are not applied: %', missing_migrations;
    END IF;

    IF to_regclass('public.document_versions') IS NOT NULL THEN
        RAISE EXCEPTION 'document_versions must not exist';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'documents'
          AND column_name = 'markdown_content'
    ) THEN
        RAISE EXCEPTION 'documents.markdown_content must not exist';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'documents'
          AND column_name = 'is_public'
          AND is_nullable = 'NO'
          AND column_default = 'false'
    ) THEN
        RAISE EXCEPTION 'documents.is_public is not NOT NULL DEFAULT false';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_index
        WHERE indexrelid = to_regclass('public.users_email_lower_key')
          AND indisunique AND indisready AND indisvalid
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_index
        WHERE indexrelid = to_regclass(
            'public.documents_workspace_updated_cursor_idx'
        ) AND indisready AND indisvalid
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_index
        WHERE indexrelid = to_regclass(
            'public.workspace_members_workspace_created_cursor_idx'
        ) AND indisready AND indisvalid
    ) THEN
        RAISE EXCEPTION 'a core v1 uniqueness or cursor index is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'document_event_ids_batch_row_id_document_id_fkey'
          AND conrelid = 'public.document_event_ids'::regclass
          AND confrelid = 'public.document_event_batches'::regclass
          AND contype = 'f' AND convalidated
          AND confdeltype = 'c' AND confupdtype = 'c'
    ) THEN
        RAISE EXCEPTION 'collaboration composite foreign key is invalid';
    END IF;

    IF to_regprocedure('private.is_workspace_member(integer)') IS NULL
       OR to_regprocedure('private.is_workspace_owner(integer)') IS NULL
       OR to_regprocedure('private.can_edit_workspace(integer)') IS NULL
       OR to_regprocedure('private.touch_document_from_event_batch()') IS NULL
    THEN
        RAISE EXCEPTION 'private authorization or audit helpers are incomplete';
    END IF;

    WITH expected(table_name, policy_name) AS (
        VALUES
            ('users', 'users_select_own'),
            ('users', 'users_update_own'),
            ('workspaces', 'workspaces_select_member'),
            ('workspaces', 'workspaces_insert_owner'),
            ('workspaces', 'workspaces_update_owner'),
            ('workspaces', 'workspaces_delete_owner'),
            ('workspace_members', 'workspace_members_select_member'),
            ('documents', 'documents_select_member'),
            ('documents', 'documents_insert_editor'),
            ('documents', 'documents_update_editor'),
            ('documents', 'documents_delete_author_or_owner')
    )
    SELECT string_agg(
        expected.table_name || '.' || expected.policy_name,
        ', ' ORDER BY expected.table_name, expected.policy_name
    )
    INTO missing_policies
    FROM expected
    LEFT JOIN pg_policies AS policy
      ON policy.schemaname = 'public'
     AND policy.tablename = expected.table_name
     AND policy.policyname = expected.policy_name
    WHERE policy.policyname IS NULL;
    IF missing_policies IS NOT NULL THEN
        RAISE EXCEPTION 'required RLS policies are missing: %', missing_policies;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'workspace_members'
          AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
    ) THEN
        RAISE EXCEPTION 'workspace_members still exposes direct write policies';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'documents'
          AND roles @> ARRAY['anon'::name]
    ) THEN
        RAISE EXCEPTION 'anonymous document table policy still exists';
    END IF;

    IF NOT (
        SELECT bool_and(relrowsecurity)
        FROM pg_class
        WHERE oid IN (
            'public.users'::regclass,
            'public.workspaces'::regclass,
            'public.workspace_members'::regclass,
            'public.documents'::regclass,
            'public.document_event_batches'::regclass,
            'public.document_event_ids'::regclass
        )
    ) THEN
        RAISE EXCEPTION 'RLS is disabled on a protected table';
    END IF;

    IF has_table_privilege('anon', 'public.documents', 'SELECT')
       OR has_table_privilege('authenticated', 'public.workspace_members', 'INSERT')
       OR has_table_privilege('authenticated', 'public.workspace_members', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.workspace_members', 'DELETE')
       OR has_column_privilege(
            'authenticated', 'public.documents', 'is_public', 'UPDATE'
       )
       OR has_column_privilege(
            'authenticated', 'public.documents', 'workspace_id', 'UPDATE'
       )
       OR has_column_privilege(
            'authenticated', 'public.users', 'email', 'UPDATE'
       )
       OR has_column_privilege(
            'authenticated', 'public.users', 'id', 'UPDATE'
       )
    THEN
        RAISE EXCEPTION 'a forbidden Data API table or column grant exists';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM (VALUES ('anon'), ('authenticated')) AS api_roles(role_name)
        CROSS JOIN (
            VALUES
                ('public.document_event_batches'),
                ('public.document_event_ids')
        ) AS event_tables(table_name)
        CROSS JOIN (
            VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
                   ('REFERENCES'), ('TRUNCATE')
        ) AS privileges(privilege_name)
        WHERE has_table_privilege(
            api_roles.role_name::name,
            event_tables.table_name,
            privileges.privilege_name
        )
    ) THEN
        RAISE EXCEPTION 'event tables are exposed to Data API roles';
    END IF;

    IF to_regprocedure('public.list_workspace_members(integer)') IS NULL
       OR to_regprocedure(
            'public.add_workspace_member_by_email(integer,text,text)'
       ) IS NULL
       OR to_regprocedure(
            'public.set_workspace_member_role(integer,uuid,text)'
       ) IS NULL
       OR to_regprocedure('public.remove_workspace_member(integer,uuid)') IS NULL
       OR to_regprocedure('public.set_document_public(uuid,boolean)') IS NULL
       OR to_regprocedure('public.get_public_document_by_slug(text)') IS NULL
       OR to_regprocedure(
            'public.append_document_event_batches(uuid,uuid,jsonb)'
       ) IS NULL
       OR to_regprocedure(
            'public.read_document_event_page(uuid,bigint,integer)'
       ) IS NULL
    THEN
        RAISE EXCEPTION 'a core behavior RPC is missing';
    END IF;
    IF has_function_privilege(
        'public', 'public.list_workspace_members(integer)', 'EXECUTE'
    ) OR has_function_privilege(
        'anon', 'public.list_workspace_members(integer)', 'EXECUTE'
    ) OR NOT has_function_privilege(
        'authenticated', 'public.list_workspace_members(integer)', 'EXECUTE'
    ) OR NOT has_function_privilege(
        'anon', 'public.get_public_document_by_slug(text)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'core RPC execute grants are unsafe';
    END IF;

    IF has_function_privilege(
        'public',
        'public.append_document_event_batches(uuid,uuid,jsonb)',
        'EXECUTE'
    ) OR has_function_privilege(
        'anon',
        'public.append_document_event_batches(uuid,uuid,jsonb)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.append_document_event_batches(uuid,uuid,jsonb)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.append_document_event_batches(uuid,uuid,jsonb)',
        'EXECUTE'
    ) OR has_function_privilege(
        'public',
        'public.read_document_event_page(uuid,bigint,integer)',
        'EXECUTE'
    ) OR has_function_privilege(
        'anon',
        'public.read_document_event_page(uuid,bigint,integer)',
        'EXECUTE'
    ) OR has_function_privilege(
        'authenticated',
        'public.read_document_event_page(uuid,bigint,integer)',
        'EXECUTE'
    ) OR NOT has_function_privilege(
        'service_role',
        'public.read_document_event_page(uuid,bigint,integer)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'collaboration RPC execute grants are unsafe';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname = 'trg_event_batch_touch_document'
          AND tgrelid = 'public.document_event_batches'::regclass
          AND tgfoid = to_regprocedure(
              'private.touch_document_from_event_batch()'
          )
    ) THEN
        RAISE EXCEPTION 'event batch document audit trigger is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM storage.buckets
        WHERE id = 'avatars'
          AND public IS TRUE
          AND file_size_limit = 2097152
          AND allowed_mime_types @> ARRAY[
              'image/jpeg', 'image/png', 'image/webp'
          ]::TEXT[]
    ) THEN
        RAISE EXCEPTION 'avatars bucket limits are incorrect';
    END IF;
    IF (
        SELECT count(*) FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname IN (
              'avatar_insert_own_directory',
              'avatar_update_own_directory',
              'avatar_delete_own_directory'
          )
    ) <> 3 THEN
        RAISE EXCEPTION 'avatar write policies are incomplete';
    END IF;
END;
$$;
