ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can access documents in their workspace" ON documents
    FOR ALL
    USING (
    is_public = true OR
    EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = documents.workspace_id
          AND user_id = (SELECT auth.uid())
    )
    )
    WITH CHECK (
    EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = documents.workspace_id
          AND user_id = (SELECT auth.uid())
    )
    );

CREATE POLICY "view documents" ON documents
    FOR SELECT
    USING (
    is_public = true OR
    is_author((SELECT auth.uid()), author_id) OR
    is_workspace_member((SELECT auth.uid()), workspace_id)
    );

CREATE POLICY "insert documents" ON documents
    FOR INSERT
    WITH CHECK (
    is_workspace_member((SELECT auth.uid()), workspace_id)
    );

CREATE POLICY "update documents" ON documents
    FOR UPDATE
    USING (
    is_author((SELECT auth.uid()), author_id) OR
    is_workspace_owner((SELECT auth.uid()), workspace_id)
    );

CREATE POLICY "delete documents" ON documents
    FOR DELETE
    USING (
    is_author((SELECT auth.uid()), author_id) OR
    is_workspace_owner((SELECT auth.uid()), workspace_id)
    );
