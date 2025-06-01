CREATE OR REPLACE FUNCTION set_metadata_on_update()
    RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    NEW.updated_by := COALESCE((SELECT auth.uid()), NEW.updated_by);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
