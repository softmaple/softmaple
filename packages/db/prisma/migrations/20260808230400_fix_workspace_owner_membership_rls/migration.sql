-- Creating a workspace must also create the owner's membership row.
-- Without this, the first workspace_members INSERT ... RETURNING fails RLS:
-- INSERT is allowed via workspaces.owner_id, but SELECT still requires an
-- existing membership row (chicken-and-egg with .insert().select()).
CREATE OR REPLACE FUNCTION private.create_owner_workspace_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.workspace_members (
        workspace_id,
        user_id,
        role,
        created_by,
        updated_by,
        invited_by
    )
    VALUES (
        NEW.id,
        NEW.owner_id,
        'OWNER',
        NEW.owner_id,
        NEW.owner_id,
        NEW.owner_id
    )
    ON CONFLICT (user_id, workspace_id) DO NOTHING;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.create_owner_workspace_member() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_workspaces_create_owner_member ON public.workspaces;
CREATE TRIGGER trg_workspaces_create_owner_member
    AFTER INSERT ON public.workspaces
    FOR EACH ROW
    EXECUTE FUNCTION private.create_owner_workspace_member();

-- Users must be able to read their own membership rows (including RETURNING
-- after a self-insert when inviting is not going through the owner trigger).
DROP POLICY IF EXISTS "workspace_members_select_member"
    ON public.workspace_members;
CREATE POLICY "workspace_members_select_member" ON public.workspace_members
    FOR SELECT TO authenticated
    USING (
        user_id = (SELECT auth.uid())
        OR private.is_workspace_member(workspace_id)
    );

NOTIFY pgrst, 'reload schema';
