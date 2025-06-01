ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user can view their memberships" ON workspace_members
    FOR SELECT
    USING (
    user_id = (SELECT auth.uid())
    );

CREATE POLICY "owner can insert members" ON workspace_members
    FOR INSERT
    WITH CHECK (
    is_workspace_owner((SELECT auth.uid()), workspace_id)
    );

CREATE POLICY "owner can update members" ON workspace_members
    FOR UPDATE
    USING (
    is_workspace_owner((SELECT auth.uid()), workspace_id)
    );

CREATE POLICY "owner can delete members" ON workspace_members
    FOR DELETE
    USING (
    is_workspace_owner((SELECT auth.uid()), workspace_id)
    );
