-- on insert
CREATE TRIGGER trg_documents_insert
    BEFORE INSERT ON documents
    FOR EACH ROW
EXECUTE FUNCTION set_metadata_on_insert();

-- on update
CREATE TRIGGER trg_documents_update
    BEFORE UPDATE ON documents
    FOR EACH ROW
EXECUTE FUNCTION set_metadata_on_update();
