-- 1. Allow schema access
GRANT USAGE ON SCHEMA public TO authenticated, anon;

-- 2. Allow table access
GRANT ALL ON TABLE workspaces TO authenticated, anon;
GRANT ALL ON TABLE workspace_members TO authenticated, anon;
GRANT ALL ON TABLE documents TO authenticated, anon;
GRANT ALL ON TABLE document_versions TO authenticated, anon;
GRANT ALL ON TABLE users TO authenticated, anon;

-- 3. Allow sequence access (for autoincrement ID fields)
GRANT USAGE, SELECT ON SEQUENCE workspaces_id_seq TO authenticated, anon;
