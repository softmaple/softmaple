CREATE TRIGGER trg_workspaces_insert
    BEFORE INSERT ON workspaces
    FOR EACH ROW
EXECUTE FUNCTION set_metadata_on_insert();

CREATE TRIGGER trg_workspaces_update
    BEFORE UPDATE ON workspaces
    FOR EACH ROW
EXECUTE FUNCTION set_metadata_on_update();
