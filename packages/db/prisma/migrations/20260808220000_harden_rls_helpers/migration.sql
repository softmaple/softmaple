-- Keep authorization helpers outside the Data API surface and bind every
-- decision to auth.uid(). The former public helpers accepted an arbitrary
-- user UUID and could therefore be used as membership-probing RPCs.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE CREATE ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.is_workspace_member(
    p_workspace_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members AS member
        WHERE member.workspace_id = p_workspace_id
          AND member.user_id = (SELECT auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION private.is_workspace_owner(
    p_workspace_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members AS member
        WHERE member.workspace_id = p_workspace_id
          AND member.user_id = (SELECT auth.uid())
          AND member.role = 'OWNER'
    ) OR EXISTS (
        SELECT 1
        FROM public.workspaces AS workspace
        WHERE workspace.id = p_workspace_id
          AND workspace.owner_id = (SELECT auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION private.can_edit_workspace(
    p_workspace_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members AS member
        WHERE member.workspace_id = p_workspace_id
          AND member.user_id = (SELECT auth.uid())
          AND member.role IN ('OWNER', 'EDITOR')
    ) OR EXISTS (
        SELECT 1
        FROM public.workspaces AS workspace
        WHERE workspace.id = p_workspace_id
          AND workspace.owner_id = (SELECT auth.uid())
    );
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA private
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_workspace_member(INTEGER)
    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_workspace_owner(INTEGER)
    TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_edit_workspace(INTEGER)
    TO authenticated;

DROP POLICY IF EXISTS "workspaces_select_member" ON public.workspaces;
DROP POLICY IF EXISTS "workspaces_update_owner" ON public.workspaces;
DROP POLICY IF EXISTS "workspaces_delete_owner" ON public.workspaces;
CREATE POLICY "workspaces_select_member" ON public.workspaces
    FOR SELECT TO authenticated
    USING (
        owner_id = (SELECT auth.uid()) OR
        private.is_workspace_member(id)
    );
CREATE POLICY "workspaces_update_owner" ON public.workspaces
    FOR UPDATE TO authenticated
    USING (private.is_workspace_owner(id))
    WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY "workspaces_delete_owner" ON public.workspaces
    FOR DELETE TO authenticated
    USING (private.is_workspace_owner(id));

DROP POLICY IF EXISTS "workspace_members_select_member"
    ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_insert_owner"
    ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_update_owner"
    ON public.workspace_members;
DROP POLICY IF EXISTS "workspace_members_delete_owner"
    ON public.workspace_members;
CREATE POLICY "workspace_members_select_member" ON public.workspace_members
    FOR SELECT TO authenticated
    USING (private.is_workspace_member(workspace_id));
CREATE POLICY "workspace_members_insert_owner" ON public.workspace_members
    FOR INSERT TO authenticated
    WITH CHECK (private.is_workspace_owner(workspace_id));
CREATE POLICY "workspace_members_update_owner" ON public.workspace_members
    FOR UPDATE TO authenticated
    USING (private.is_workspace_owner(workspace_id))
    WITH CHECK (private.is_workspace_owner(workspace_id));
CREATE POLICY "workspace_members_delete_owner" ON public.workspace_members
    FOR DELETE TO authenticated
    USING (private.is_workspace_owner(workspace_id));

DROP POLICY IF EXISTS "documents_select_visible" ON public.documents;
DROP POLICY IF EXISTS "documents_insert_editor" ON public.documents;
DROP POLICY IF EXISTS "documents_update_editor" ON public.documents;
DROP POLICY IF EXISTS "documents_delete_author_or_owner" ON public.documents;
CREATE POLICY "documents_select_visible" ON public.documents
    FOR SELECT TO anon, authenticated
    USING (
        is_public IS TRUE OR
        private.is_workspace_member(workspace_id)
    );
CREATE POLICY "documents_insert_editor" ON public.documents
    FOR INSERT TO authenticated
    WITH CHECK (
        author_id = (SELECT auth.uid()) AND
        private.can_edit_workspace(workspace_id)
    );
CREATE POLICY "documents_update_editor" ON public.documents
    FOR UPDATE TO authenticated
    USING (private.can_edit_workspace(workspace_id))
    WITH CHECK (private.can_edit_workspace(workspace_id));
CREATE POLICY "documents_delete_author_or_owner" ON public.documents
    FOR DELETE TO authenticated
    USING (
        author_id = (SELECT auth.uid()) OR
        private.is_workspace_owner(workspace_id)
    );

DROP POLICY IF EXISTS "document_versions_select_member"
    ON public.document_versions;
DROP POLICY IF EXISTS "document_versions_insert_editor"
    ON public.document_versions;
CREATE POLICY "document_versions_select_member" ON public.document_versions
    FOR SELECT TO authenticated
    USING (private.is_workspace_member(workspace_id));
CREATE POLICY "document_versions_insert_editor" ON public.document_versions
    FOR INSERT TO authenticated
    WITH CHECK (private.can_edit_workspace(workspace_id));

DROP FUNCTION public.is_workspace_member(UUID, INTEGER);
DROP FUNCTION public.is_workspace_owner(UUID, INTEGER);
DROP FUNCTION public.can_edit_workspace(UUID, INTEGER);

NOTIFY pgrst, 'reload schema';
