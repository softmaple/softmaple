CREATE OR REPLACE FUNCTION set_user_full_name_and_metadata()
    RETURNS TRIGGER AS $$
DECLARE
    current_user_id UUID := (SELECT auth.uid());
BEGIN
    -- full_name: join first and last name
    NEW.full_name := COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '');

    -- INSERT only
    IF TG_OP = 'INSERT' THEN
        NEW.created_at := NOW();

        -- Only set created_by if not provided and auth.uid() exists
        IF (NEW.created_by IS NULL) AND (current_user_id IS NOT NULL) THEN
            NEW.created_by := current_user_id;
        END IF;
    END IF;

    -- UPDATE always
    NEW.updated_at := NOW();

    IF (NEW.updated_by IS NULL) AND (current_user_id IS NOT NULL) THEN
        NEW.updated_by := current_user_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
