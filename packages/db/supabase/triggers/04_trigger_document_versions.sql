CREATE TRIGGER trg_document_versions_insert
    BEFORE INSERT ON document_versions
    FOR EACH ROW
EXECUTE FUNCTION set_metadata_on_insert();

CREATE TRIGGER trg_document_versions_update
    BEFORE UPDATE ON document_versions
    FOR EACH ROW
EXECUTE FUNCTION set_metadata_on_update();
