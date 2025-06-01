-- Before INSERT: set full name and metadata
CREATE TRIGGER trg_users_insert
    BEFORE INSERT ON users
    FOR EACH ROW
EXECUTE FUNCTION set_user_full_name_and_metadata();

-- Before UPDATE: update full name and metadata
CREATE TRIGGER trg_users_update
    BEFORE UPDATE ON users
    FOR EACH ROW
EXECUTE FUNCTION set_user_full_name_and_metadata();
