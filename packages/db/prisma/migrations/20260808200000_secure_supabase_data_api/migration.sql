-- Supabase Auth profile synchronization and least-privilege Data API access.
-- Collaboration event tables remain server-only and receive no API grants.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.users (id, email, first_name, last_name, full_name)
    VALUES (
        NEW.id,
        NEW.email,
        NULLIF(NEW.raw_user_meta_data->>'first_name', ''),
        NULLIF(NEW.raw_user_meta_data->>'last_name', ''),
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), '')
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        first_name = COALESCE(EXCLUDED.first_name, users.first_name),
        last_name = COALESCE(EXCLUDED.last_name, users.last_name),
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), users.full_name),
        updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT OR UPDATE OF email, raw_user_meta_data ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.set_metadata_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.created_at := NOW();
    NEW.updated_at := NOW();
    NEW.created_by := COALESCE(NEW.created_by, (SELECT auth.uid()));
    NEW.updated_by := COALESCE(NEW.updated_by, (SELECT auth.uid()));
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_metadata_on_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := NOW();
    NEW.updated_by := COALESCE((SELECT auth.uid()), NEW.updated_by);
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_full_name_and_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.full_name := COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name)), ''),
        NEW.full_name,
        ''
    );
    IF TG_OP = 'INSERT' THEN
        NEW.created_at := NOW();
        NEW.created_by := COALESCE(NEW.created_by, (SELECT auth.uid()));
    END IF;
    NEW.updated_at := NOW();
    NEW.updated_by := COALESCE((SELECT auth.uid()), NEW.updated_by);
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_documents_insert ON public.documents;
DROP TRIGGER IF EXISTS trg_documents_update ON public.documents;
CREATE TRIGGER trg_documents_insert BEFORE INSERT ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.set_metadata_on_insert();
CREATE TRIGGER trg_documents_update BEFORE UPDATE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.set_metadata_on_update();

DROP TRIGGER IF EXISTS trg_workspaces_insert ON public.workspaces;
DROP TRIGGER IF EXISTS trg_workspaces_update ON public.workspaces;
CREATE TRIGGER trg_workspaces_insert BEFORE INSERT ON public.workspaces
    FOR EACH ROW EXECUTE FUNCTION public.set_metadata_on_insert();
CREATE TRIGGER trg_workspaces_update BEFORE UPDATE ON public.workspaces
    FOR EACH ROW EXECUTE FUNCTION public.set_metadata_on_update();

DROP TRIGGER IF EXISTS trg_workspace_members_insert ON public.workspace_members;
DROP TRIGGER IF EXISTS trg_workspace_members_update ON public.workspace_members;
CREATE TRIGGER trg_workspace_members_insert BEFORE INSERT ON public.workspace_members
    FOR EACH ROW EXECUTE FUNCTION public.set_metadata_on_insert();
CREATE TRIGGER trg_workspace_members_update BEFORE UPDATE ON public.workspace_members
    FOR EACH ROW EXECUTE FUNCTION public.set_metadata_on_update();

DROP TRIGGER IF EXISTS trg_document_versions_insert ON public.document_versions;
DROP TRIGGER IF EXISTS trg_document_versions_update ON public.document_versions;
CREATE TRIGGER trg_document_versions_insert BEFORE INSERT ON public.document_versions
    FOR EACH ROW EXECUTE FUNCTION public.set_metadata_on_insert();
CREATE TRIGGER trg_document_versions_update BEFORE UPDATE ON public.document_versions
    FOR EACH ROW EXECUTE FUNCTION public.set_metadata_on_update();

DROP TRIGGER IF EXISTS trg_users_insert ON public.users;
DROP TRIGGER IF EXISTS trg_users_update ON public.users;
CREATE TRIGGER trg_users_insert BEFORE INSERT ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.set_user_full_name_and_metadata();
CREATE TRIGGER trg_users_update BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.set_user_full_name_and_metadata();

CREATE OR REPLACE FUNCTION public.is_workspace_member(
    p_user_id UUID,
    p_workspace_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members AS member
        WHERE member.workspace_id = p_workspace_id
          AND member.user_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_owner(
    p_user_id UUID,
    p_workspace_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members AS member
        WHERE member.workspace_id = p_workspace_id
          AND member.user_id = p_user_id
          AND member.role = 'OWNER'
    ) OR EXISTS (
        SELECT 1
        FROM public.workspaces AS workspace
        WHERE workspace.id = p_workspace_id
          AND workspace.owner_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_workspace(
    p_user_id UUID,
    p_workspace_id INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members AS member
        WHERE member.workspace_id = p_workspace_id
          AND member.user_id = p_user_id
          AND member.role IN ('OWNER', 'EDITOR')
    ) OR EXISTS (
        SELECT 1
        FROM public.workspaces AS workspace
        WHERE workspace.id = p_workspace_id
          AND workspace.owner_id = p_user_id
    );
$$;

REVOKE ALL ON FUNCTION public.is_workspace_member(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_owner(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_edit_workspace(UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(UUID, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_owner(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_workspace(UUID, INTEGER) TO authenticated;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "User can access their own record" ON public.users;
DROP POLICY IF EXISTS "users_select_own" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_select_own" ON public.users FOR SELECT TO authenticated
    USING (id = (SELECT auth.uid()));
CREATE POLICY "users_update_own" ON public.users FOR UPDATE TO authenticated
    USING (id = (SELECT auth.uid()))
    WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Only owner can access or modify workspace" ON public.workspaces;
DROP POLICY IF EXISTS "Any authenticated user can insert workspace" ON public.workspaces;
DROP POLICY IF EXISTS "read workspaces joined" ON public.workspaces;
DROP POLICY IF EXISTS "owner can update workspace" ON public.workspaces;
DROP POLICY IF EXISTS "owner can delete workspace" ON public.workspaces;
CREATE POLICY "workspaces_select_member" ON public.workspaces FOR SELECT TO authenticated
    USING (
        owner_id = (SELECT auth.uid()) OR
        public.is_workspace_member((SELECT auth.uid()), id)
    );
CREATE POLICY "workspaces_insert_owner" ON public.workspaces FOR INSERT TO authenticated
    WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY "workspaces_update_owner" ON public.workspaces FOR UPDATE TO authenticated
    USING (public.is_workspace_owner((SELECT auth.uid()), id))
    WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY "workspaces_delete_owner" ON public.workspaces FOR DELETE TO authenticated
    USING (public.is_workspace_owner((SELECT auth.uid()), id));

DROP POLICY IF EXISTS "user can view their memberships" ON public.workspace_members;
DROP POLICY IF EXISTS "owner can insert members" ON public.workspace_members;
DROP POLICY IF EXISTS "owner can update members" ON public.workspace_members;
DROP POLICY IF EXISTS "owner can delete members" ON public.workspace_members;
CREATE POLICY "workspace_members_select_member" ON public.workspace_members FOR SELECT TO authenticated
    USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY "workspace_members_insert_owner" ON public.workspace_members FOR INSERT TO authenticated
    WITH CHECK (public.is_workspace_owner((SELECT auth.uid()), workspace_id));
CREATE POLICY "workspace_members_update_owner" ON public.workspace_members FOR UPDATE TO authenticated
    USING (public.is_workspace_owner((SELECT auth.uid()), workspace_id))
    WITH CHECK (public.is_workspace_owner((SELECT auth.uid()), workspace_id));
CREATE POLICY "workspace_members_delete_owner" ON public.workspace_members FOR DELETE TO authenticated
    USING (public.is_workspace_owner((SELECT auth.uid()), workspace_id));

DROP POLICY IF EXISTS "Users can access documents in their workspace" ON public.documents;
DROP POLICY IF EXISTS "view documents" ON public.documents;
DROP POLICY IF EXISTS "insert documents" ON public.documents;
DROP POLICY IF EXISTS "update documents" ON public.documents;
DROP POLICY IF EXISTS "delete documents" ON public.documents;
CREATE POLICY "documents_select_visible" ON public.documents FOR SELECT TO anon, authenticated
    USING (
        is_public IS TRUE OR
        public.is_workspace_member((SELECT auth.uid()), workspace_id)
    );
CREATE POLICY "documents_insert_editor" ON public.documents FOR INSERT TO authenticated
    WITH CHECK (
        author_id = (SELECT auth.uid()) AND
        public.can_edit_workspace((SELECT auth.uid()), workspace_id)
    );
CREATE POLICY "documents_update_editor" ON public.documents FOR UPDATE TO authenticated
    USING (public.can_edit_workspace((SELECT auth.uid()), workspace_id))
    WITH CHECK (public.can_edit_workspace((SELECT auth.uid()), workspace_id));
CREATE POLICY "documents_delete_author_or_owner" ON public.documents FOR DELETE TO authenticated
    USING (
        author_id = (SELECT auth.uid()) OR
        public.is_workspace_owner((SELECT auth.uid()), workspace_id)
    );

DROP POLICY IF EXISTS "Users can access versions in their workspace" ON public.document_versions;
DROP POLICY IF EXISTS "read document versions" ON public.document_versions;
CREATE POLICY "document_versions_select_member" ON public.document_versions FOR SELECT TO authenticated
    USING (public.is_workspace_member((SELECT auth.uid()), workspace_id));
CREATE POLICY "document_versions_insert_editor" ON public.document_versions FOR INSERT TO authenticated
    WITH CHECK (public.can_edit_workspace((SELECT auth.uid()), workspace_id));

REVOKE ALL ON TABLE public.users FROM anon, authenticated;
REVOKE ALL ON TABLE public.workspaces FROM anon, authenticated;
REVOKE ALL ON TABLE public.workspace_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.documents FROM anon, authenticated;
REVOKE ALL ON TABLE public.document_versions FROM anon, authenticated;

GRANT SELECT, UPDATE ON TABLE public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspaces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.workspace_members TO authenticated;
GRANT SELECT ON TABLE public.documents TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documents TO authenticated;
GRANT SELECT, INSERT ON TABLE public.document_versions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.workspaces_id_seq TO authenticated;
