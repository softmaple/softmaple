ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only owner can access or modify workspace" ON workspaces
    FOR ALL
    USING (
    EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = workspaces.id
          AND user_id = (SELECT auth.uid())
          AND role = 'OWNER'
    )
    )
    WITH CHECK (
    EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = workspaces.id
          AND user_id = (SELECT auth.uid())
          AND role = 'OWNER'
    )
    );

CREATE POLICY "Any authenticated user can insert workspace"
    ON workspaces
    FOR INSERT
    WITH CHECK (
    (SELECT auth.uid()) IS NOT NULL
    );

CREATE POLICY "read workspaces joined" ON workspaces
    FOR SELECT
    USING (
    is_workspace_member((SELECT auth.uid()), id)
    );

CREATE POLICY "owner can update workspace" ON workspaces
    FOR UPDATE
    USING (
    is_workspace_owner((SELECT auth.uid()), id)
    );

CREATE POLICY "owner can delete workspace" ON workspaces
    FOR DELETE
    USING (
    is_workspace_owner((SELECT auth.uid()), id)
    );
