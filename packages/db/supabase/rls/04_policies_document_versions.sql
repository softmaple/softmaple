ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access versions in their workspace" ON document_versions
    FOR ALL
    USING (
    EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = document_versions.workspace_id
          AND user_id = (SELECT auth.uid())
    )
    )
    WITH CHECK (
    EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = document_versions.workspace_id
          AND user_id = (SELECT auth.uid())
    )
    );

CREATE POLICY "read document versions" ON document_versions
    FOR SELECT
    USING (
    is_workspace_member((SELECT auth.uid()), workspace_id)
    );
