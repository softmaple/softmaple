CREATE OR REPLACE FUNCTION set_metadata_on_insert()
    RETURNS TRIGGER AS $$
BEGIN
    -- timestamps
    NEW.created_at := NOW();
    NEW.updated_at := NOW();

    -- user tracking
    NEW.created_by := COALESCE(NEW.created_by, (SELECT auth.uid()));
    NEW.updated_by := COALESCE(NEW.updated_by, (SELECT auth.uid()));

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
