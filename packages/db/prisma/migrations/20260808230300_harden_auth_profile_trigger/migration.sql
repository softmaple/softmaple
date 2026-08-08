-- Keep the Auth trigger's elevated privileges independent of caller-controlled
-- search paths. The table alias fully qualifies references to the target row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.users AS existing (
        id,
        email,
        first_name,
        last_name,
        full_name
    )
    VALUES (
        NEW.id,
        NEW.email,
        NULLIF(NEW.raw_user_meta_data->>'first_name', ''),
        NULLIF(NEW.raw_user_meta_data->>'last_name', ''),
        COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), '')
    )
    ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        first_name = COALESCE(EXCLUDED.first_name, existing.first_name),
        last_name = COALESCE(EXCLUDED.last_name, existing.last_name),
        full_name = COALESCE(
            NULLIF(EXCLUDED.full_name, ''),
            existing.full_name
        ),
        updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
