-- Preserve document ownership across the event-ID guard relation. This is a
-- forward migration because the original collaboration migrations are already
-- deployed and must not be rewritten.
CREATE UNIQUE INDEX "document_event_batches_id_document_id_key"
    ON "document_event_batches"("id", "document_id");

ALTER TABLE "document_event_ids"
    DROP CONSTRAINT "document_event_ids_batch_row_id_fkey";

ALTER TABLE "document_event_ids"
    ADD CONSTRAINT "document_event_ids_batch_row_id_document_id_fkey"
    FOREIGN KEY ("batch_row_id", "document_id")
    REFERENCES "document_event_batches"("id", "document_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

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
