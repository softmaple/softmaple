ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read document versions" ON document_versions
    FOR SELECT
    USING (
    is_workspace_member((SELECT auth.uid()), workspace_id)
    );

CREATE POLICY "insert document versions" ON document_versions
    FOR INSERT
    WITH CHECK (
    is_workspace_member((SELECT auth.uid()), workspace_id)
    );

CREATE POLICY "update document versions" ON document_versions
    FOR UPDATE
    USING (
    is_workspace_member((SELECT auth.uid()), workspace_id)
    );

CREATE POLICY "delete document versions" ON document_versions
    FOR DELETE
    USING (
    is_workspace_member((SELECT auth.uid()), workspace_id)
    );
