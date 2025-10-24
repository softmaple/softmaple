-- workspace_members
CREATE TRIGGER trg_workspace_members_insert
    BEFORE INSERT ON workspace_members
    FOR EACH ROW
EXECUTE FUNCTION set_metadata_on_insert();

CREATE TRIGGER trg_workspace_members_update
    BEFORE UPDATE ON workspace_members
    FOR EACH ROW
EXECUTE FUNCTION set_metadata_on_update();
