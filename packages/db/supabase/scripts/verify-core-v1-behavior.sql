-- Behavioral RLS/RPC verification against an isolated Supabase project.
-- Fixed negative workspace IDs and reserved UUIDs make targets exact. Every
-- row is rolled back, including Storage objects.
BEGIN;

INSERT INTO public.users (id, email, full_name)
VALUES
    ('aaaaaaaa-0000-4000-8000-000000000001', 'core-v1-owner@example.invalid', 'Core Owner'),
    ('bbbbbbbb-0000-4000-8000-000000000002', 'core-v1-editor@example.invalid', 'Core Editor'),
    ('cccccccc-0000-4000-8000-000000000003', 'core-v1-viewer@example.invalid', 'Core Viewer'),
    ('dddddddd-0000-4000-8000-000000000004', 'core-v1-outsider@example.invalid', 'Core Outsider');

INSERT INTO public.workspaces (id, title, description, slug, owner_id)
VALUES
    (-91001, 'Core workspace A', 'RLS behavior fixture', 'core-v1-a-verify', 'aaaaaaaa-0000-4000-8000-000000000001'),
    (-91002, 'Core workspace B', 'Isolation fixture', 'core-v1-b-verify', 'dddddddd-0000-4000-8000-000000000004');

INSERT INTO public.workspace_members (
    user_id, workspace_id, role, invited_by, created_by, updated_by
)
VALUES
    ('bbbbbbbb-0000-4000-8000-000000000002', -91001, 'EDITOR', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001'),
    ('cccccccc-0000-4000-8000-000000000003', -91001, 'VIEWER', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');

INSERT INTO public.documents (id, workspace_id, author_id, title, slug)
VALUES
    ('a1000000-0000-4000-8000-000000000001', -91001, 'aaaaaaaa-0000-4000-8000-000000000001', 'Workspace A document', 'core-v1-doc-a-verify'),
    ('b2000000-0000-4000-8000-000000000002', -91002, 'dddddddd-0000-4000-8000-000000000004', 'Workspace B document', 'core-v1-doc-b-verify');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);

DO $behavior$
DECLARE
    affected INTEGER;
    owner_member_id UUID;
    temporary_member_id UUID;
BEGIN
    UPDATE public.workspaces SET title = 'Core workspace A renamed' WHERE id = -91001;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'owner could not update own workspace';
    END IF;

    IF (SELECT count(*) FROM public.list_workspace_members(-91001)) <> 3
       OR (SELECT count(email) FROM public.list_workspace_members(-91001)) <> 3
    THEN
        RAISE EXCEPTION 'owner member directory or email visibility is incorrect';
    END IF;

    PERFORM public.set_document_public(
        'a1000000-0000-4000-8000-000000000001', true
    );

    temporary_member_id := public.add_workspace_member_by_email(
        -91001, 'CORE-V1-OUTSIDER@example.invalid', 'VIEWER'
    );
    PERFORM public.set_workspace_member_role(-91001, temporary_member_id, 'EDITOR');
    PERFORM public.remove_workspace_member(-91001, temporary_member_id);

    SELECT id INTO owner_member_id
    FROM public.workspace_members
    WHERE workspace_id = -91001 AND role = 'OWNER';

    BEGIN
        PERFORM public.set_workspace_member_role(-91001, owner_member_id, 'EDITOR');
        RAISE EXCEPTION 'owner role mutation unexpectedly succeeded';
    EXCEPTION WHEN no_data_found THEN
        NULL;
    END;

    BEGIN
        PERFORM public.remove_workspace_member(-91001, owner_member_id);
        RAISE EXCEPTION 'owner removal unexpectedly succeeded';
    EXCEPTION WHEN no_data_found THEN
        NULL;
    END;
END;
$behavior$;

SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-000000000002', true);

DO $behavior$
DECLARE
    affected INTEGER;
BEGIN
    IF (SELECT count(*) FROM public.workspaces WHERE id = -91002) <> 0
       OR (SELECT count(*) FROM public.documents WHERE workspace_id = -91002) <> 0
    THEN
        RAISE EXCEPTION 'editor can read across workspaces';
    END IF;

    UPDATE public.workspaces SET title = 'Forbidden' WHERE id = -91001;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN
        RAISE EXCEPTION 'editor updated workspace metadata';
    END IF;

    UPDATE public.documents
    SET title = 'Editor-renamed document'
    WHERE id = 'a1000000-0000-4000-8000-000000000001';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'editor could not rename a workspace document';
    END IF;

    INSERT INTO public.documents (id, workspace_id, author_id, title, slug)
    VALUES (
        'b1000000-0000-4000-8000-000000000003', -91001,
        'bbbbbbbb-0000-4000-8000-000000000002',
        'Editor-owned document', 'core-v1-editor-doc-verify'
    );
    DELETE FROM public.documents
    WHERE id = 'b1000000-0000-4000-8000-000000000003';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
        RAISE EXCEPTION 'editor could not delete own document';
    END IF;

    IF (SELECT count(email) FROM public.list_workspace_members(-91001)) <> 0 THEN
        RAISE EXCEPTION 'member directory leaked email addresses to editor';
    END IF;

    BEGIN
        PERFORM public.set_document_public(
            'a1000000-0000-4000-8000-000000000001', false
        );
        RAISE EXCEPTION 'editor changed public sharing';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    BEGIN
        INSERT INTO public.workspace_members (user_id, workspace_id, role)
        VALUES ('dddddddd-0000-4000-8000-000000000004', -91001, 'VIEWER');
        RAISE EXCEPTION 'direct member write unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END;
$behavior$;

SELECT set_config('request.jwt.claim.sub', 'cccccccc-0000-4000-8000-000000000003', true);

DO $behavior$
DECLARE
    affected INTEGER;
BEGIN
    IF (SELECT count(*) FROM public.documents WHERE workspace_id = -91001) <> 1 THEN
        RAISE EXCEPTION 'viewer cannot read workspace document';
    END IF;

    UPDATE public.documents SET title = 'Forbidden viewer edit'
    WHERE id = 'a1000000-0000-4000-8000-000000000001';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN
        RAISE EXCEPTION 'viewer updated a document';
    END IF;

    BEGIN
        INSERT INTO public.documents (workspace_id, author_id, title, slug)
        VALUES (
            -91001, 'cccccccc-0000-4000-8000-000000000003',
            'Forbidden viewer document', 'core-v1-viewer-doc-verify'
        );
        RAISE EXCEPTION 'viewer created a document';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    IF (SELECT count(email) FROM public.list_workspace_members(-91001)) <> 0 THEN
        RAISE EXCEPTION 'member directory leaked email addresses to viewer';
    END IF;
END;
$behavior$;

SELECT set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000004', true);

DO $behavior$
BEGIN
    IF (SELECT count(*) FROM public.documents WHERE workspace_id = -91001) <> 0 THEN
        RAISE EXCEPTION 'outsider can enumerate another workspace documents';
    END IF;
    BEGIN
        PERFORM public.list_workspace_members(-91001);
        RAISE EXCEPTION 'outsider loaded another workspace directory';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END;
$behavior$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);

DO $behavior$
BEGIN
    IF (
        SELECT count(*)
        FROM public.get_public_document_by_slug('core-v1-doc-a-verify')
    ) <> 1 OR (
        SELECT count(*)
        FROM public.get_public_document_by_slug('core-v1-doc-b-verify')
    ) <> 0 THEN
        RAISE EXCEPTION 'anonymous public metadata lookup is incorrect';
    END IF;

    BEGIN
        PERFORM id FROM public.documents LIMIT 1;
        RAISE EXCEPTION 'anonymous role can enumerate documents';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END;
$behavior$;

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);

INSERT INTO storage.objects (bucket_id, name, owner_id)
VALUES (
    'avatars',
    'aaaaaaaa-0000-4000-8000-000000000001/v1/avatar.png',
    'aaaaaaaa-0000-4000-8000-000000000001'
);

SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-000000000002', true);
DO $behavior$
BEGIN
    BEGIN
        INSERT INTO storage.objects (bucket_id, name, owner_id)
        VALUES (
            'avatars',
            'aaaaaaaa-0000-4000-8000-000000000001/v2/avatar.png',
            'bbbbbbbb-0000-4000-8000-000000000002'
        );
        RAISE EXCEPTION 'avatar write escaped the caller directory';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END;
$behavior$;

RESET ROLE;
ROLLBACK;
