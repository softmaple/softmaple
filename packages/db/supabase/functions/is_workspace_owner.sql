-- Check if a user is the OWNER of a workspace
CREATE OR REPLACE FUNCTION is_workspace_owner(p_user_id UUID, p_workspace_id INT)
    RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM workspace_members
        WHERE workspace_id = p_workspace_id
          AND user_id = p_user_id
          AND role = 'OWNER'
    );
END;
$$ LANGUAGE plpgsql STABLE;
