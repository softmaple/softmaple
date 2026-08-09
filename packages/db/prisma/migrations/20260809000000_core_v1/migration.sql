-- Softmaple core v1 schema and behavior API.
-- CRDT event batches are the only document body source of truth.

UPDATE public.documents
SET is_public = FALSE
WHERE is_public IS NULL;

ALTER TABLE public.documents
    ALTER COLUMN is_public SET DEFAULT FALSE,
    ALTER COLUMN is_public SET NOT NULL;

-- Preserve legacy bodies/history before dropping them. Refuse to drop live
-- markdown that has not already been represented as CRDT event batches.
CREATE SCHEMA IF NOT EXISTS archive;

CREATE TABLE IF NOT EXISTS archive.documents_markdown_content_20260809 AS
SELECT
    document.id AS document_id,
    document.workspace_id,
    document.author_id,
    document.title,
    document.slug,
    document.markdown_content,
    document.created_at,
    document.updated_at,
    document.created_by,
    document.updated_by,
    clock_timestamp() AS archived_at
FROM public.documents AS document
WHERE document.markdown_content IS NOT NULL
  AND btrim(document.markdown_content) <> '';

CREATE TABLE IF NOT EXISTS archive.document_versions_20260809 AS
SELECT
    version.*,
    clock_timestamp() AS archived_at
FROM public.document_versions AS version;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.documents AS document
        WHERE document.markdown_content IS NOT NULL
          AND btrim(document.markdown_content) <> ''
          AND NOT EXISTS (
              SELECT 1
              FROM public.document_event_batches AS batch
              WHERE batch.document_id = document.id
          )
    ) THEN
        RAISE EXCEPTION
            'core_v1 refuses to drop markdown_content: non-empty bodies exist without document_event_batches. Backfill CRDT history first; archived rows are in archive.documents_markdown_content_20260809';
    END IF;
END
$$;

ALTER TABLE public.documents
    DROP COLUMN markdown_content;

DROP TABLE public.document_versions;

CREATE UNIQUE INDEX users_email_lower_key
    ON public.users (LOWER(email));
CREATE INDEX documents_workspace_updated_cursor_idx
    ON public.documents (workspace_id, updated_at DESC, id DESC);
CREATE INDEX workspace_members_workspace_created_cursor_idx
    ON public.workspace_members (workspace_id, created_at ASC, id ASC);

CREATE OR REPLACE FUNCTION private.touch_document_from_event_batch()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    UPDATE public.documents
    SET updated_at = NEW.created_at,
        updated_by = NEW.actor_id
    WHERE id = NEW.document_id;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.touch_document_from_event_batch() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_event_batch_touch_document
    ON public.document_event_batches;
CREATE TRIGGER trg_event_batch_touch_document
    AFTER INSERT ON public.document_event_batches
    FOR EACH ROW
    EXECUTE FUNCTION private.touch_document_from_event_batch();

-- Public behavior functions intentionally use SECURITY DEFINER because direct
-- table access cannot reveal other users' profiles. Every function binds its
-- authorization decision to auth.uid(), uses an empty search_path, and receives
-- an explicit revoke/grant block below.
CREATE OR REPLACE FUNCTION public.list_workspace_members(
    p_workspace_id INTEGER
)
RETURNS TABLE (
    member_id UUID,
    user_id UUID,
    full_name TEXT,
    avatar_src TEXT,
    role TEXT,
    email TEXT,
    joined_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    caller_is_owner BOOLEAN;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT private.is_workspace_member(p_workspace_id)
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'workspace_access_denied';
    END IF;

    caller_is_owner := private.is_workspace_owner(p_workspace_id);

    RETURN QUERY
    SELECT
        member.id,
        profile.id,
        COALESCE(NULLIF(profile.full_name, ''), 'Unnamed member'),
        profile.avatar_src,
        member.role::TEXT,
        CASE WHEN caller_is_owner THEN profile.email ELSE NULL END,
        member.created_at
    FROM public.workspace_members AS member
    INNER JOIN public.users AS profile ON profile.id = member.user_id
    WHERE member.workspace_id = p_workspace_id
    ORDER BY
        CASE WHEN member.role = 'OWNER' THEN 0 ELSE 1 END,
        LOWER(COALESCE(NULLIF(profile.full_name, ''), profile.email)),
        member.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.add_workspace_member_by_email(
    p_workspace_id INTEGER,
    p_email TEXT,
    p_role TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    target_user_id UUID;
    created_member_id UUID;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT private.is_workspace_owner(p_workspace_id)
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'workspace_owner_required';
    END IF;

    IF p_role NOT IN ('EDITOR', 'VIEWER') THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'invalid_workspace_role';
    END IF;

    SELECT profile.id
    INTO target_user_id
    FROM public.users AS profile
    WHERE LOWER(profile.email) = LOWER(TRIM(p_email));

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0002',
            MESSAGE = 'registered_user_not_found';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.workspace_members AS member
        WHERE member.workspace_id = p_workspace_id
          AND member.user_id = target_user_id
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'workspace_member_exists';
    END IF;

    INSERT INTO public.workspace_members (
        workspace_id,
        user_id,
        role,
        invited_by,
        created_by,
        updated_by
    )
    VALUES (
        p_workspace_id,
        target_user_id,
        p_role::public."WorkspaceMemberRole",
        (SELECT auth.uid()),
        (SELECT auth.uid()),
        (SELECT auth.uid())
    )
    RETURNING id INTO created_member_id;

    RETURN created_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_workspace_member_role(
    p_workspace_id INTEGER,
    p_member_id UUID,
    p_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT private.is_workspace_owner(p_workspace_id)
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'workspace_owner_required';
    END IF;

    IF p_role NOT IN ('EDITOR', 'VIEWER') THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'invalid_workspace_role';
    END IF;

    UPDATE public.workspace_members AS member
    SET role = p_role::public."WorkspaceMemberRole",
        updated_by = (SELECT auth.uid())
    WHERE member.id = p_member_id
      AND member.workspace_id = p_workspace_id
      AND member.role <> 'OWNER';

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0002',
            MESSAGE = 'member_not_found_or_owner';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_workspace_member(
    p_workspace_id INTEGER,
    p_member_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT private.is_workspace_owner(p_workspace_id)
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'workspace_owner_required';
    END IF;

    DELETE FROM public.workspace_members AS member
    WHERE member.id = p_member_id
      AND member.workspace_id = p_workspace_id
      AND member.role <> 'OWNER';

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0002',
            MESSAGE = 'member_not_found_or_owner';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_document_public(
    p_document_id UUID,
    p_enabled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    target_workspace_id INTEGER;
BEGIN
    SELECT document.workspace_id
    INTO target_workspace_id
    FROM public.documents AS document
    WHERE document.id = p_document_id;

    IF target_workspace_id IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0002',
            MESSAGE = 'document_not_found';
    END IF;

    IF (SELECT auth.uid()) IS NULL
       OR NOT private.is_workspace_owner(target_workspace_id)
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'workspace_owner_required';
    END IF;

    UPDATE public.documents
    SET is_public = p_enabled,
        updated_by = (SELECT auth.uid())
    WHERE id = p_document_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_public_document_by_slug(
    p_slug TEXT
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    slug TEXT,
    updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT document.id, document.title, document.slug, document.updated_at
    FROM public.documents AS document
    WHERE document.slug = p_slug
      AND document.is_public IS TRUE
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.list_workspace_members(INTEGER)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_workspace_member_by_email(INTEGER, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_workspace_member_role(INTEGER, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_workspace_member(INTEGER, UUID)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_document_public(UUID, BOOLEAN)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_document_by_slug(TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.list_workspace_members(INTEGER)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_workspace_member_by_email(INTEGER, TEXT, TEXT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_member_role(INTEGER, UUID, TEXT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_workspace_member(INTEGER, UUID)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_document_public(UUID, BOOLEAN)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_document_by_slug(TEXT)
    TO anon, authenticated;

-- Public links are resolved only by get_public_document_by_slug. Removing
-- anonymous table SELECT prevents documents from being enumerated.
DROP POLICY IF EXISTS "documents_select_visible" ON public.documents;
CREATE POLICY "documents_select_member" ON public.documents
    FOR SELECT TO authenticated
    USING (private.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "documents_delete_author_or_owner" ON public.documents;
CREATE POLICY "documents_delete_author_or_owner" ON public.documents
    FOR DELETE TO authenticated
    USING (
        private.is_workspace_owner(workspace_id)
        OR (
            author_id = (SELECT auth.uid())
            AND private.can_edit_workspace(workspace_id)
        )
    );

DROP POLICY IF EXISTS "workspace_members_insert_owner"
    ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_update_owner"
    ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_delete_owner"
    ON public.workspace_members;

REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.workspaces FROM anon, authenticated;
REVOKE ALL ON TABLE public.workspace_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.documents FROM anon, authenticated;

GRANT SELECT ON TABLE public.users TO authenticated;
GRANT UPDATE (first_name, last_name, full_name, avatar_src, avatar_alt)
    ON TABLE public.users TO authenticated;

GRANT SELECT, DELETE ON TABLE public.workspaces TO authenticated;
GRANT INSERT (title, description, slug, owner_id, avatar_src, avatar_alt)
    ON TABLE public.workspaces TO authenticated;
GRANT UPDATE (title, description, avatar_src, avatar_alt)
    ON TABLE public.workspaces TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.workspaces_id_seq TO authenticated;

GRANT SELECT ON TABLE public.workspace_members TO authenticated;

GRANT SELECT, DELETE ON TABLE public.documents TO authenticated;
GRANT INSERT (workspace_id, author_id, title, slug)
    ON TABLE public.documents TO authenticated;
GRANT UPDATE (title) ON TABLE public.documents TO authenticated;

-- Public avatar delivery with writes restricted to the caller's versioned
-- directory. Width/height are validated by the profile upload action.
INSERT INTO storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
VALUES (
    'avatars',
    'avatars',
    TRUE,
    2097152,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "avatar_insert_own_directory" ON storage.objects;
DROP POLICY IF EXISTS "avatar_update_own_directory" ON storage.objects;
DROP POLICY IF EXISTS "avatar_delete_own_directory" ON storage.objects;

CREATE POLICY "avatar_insert_own_directory" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
    );
CREATE POLICY "avatar_update_own_directory" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
    )
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
    );
CREATE POLICY "avatar_delete_own_directory" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::TEXT
    );

NOTIFY pgrst, 'reload schema';
