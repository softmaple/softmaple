-- Preserve document ownership across the event-ID guard relation without
-- scanning all existing rows while collaboration writes remain active.
ALTER TABLE "document_event_ids"
    DROP CONSTRAINT "document_event_ids_batch_row_id_fkey",
    ADD CONSTRAINT "document_event_ids_batch_row_id_document_id_fkey"
    FOREIGN KEY ("batch_row_id", "document_id")
    REFERENCES "document_event_batches"("id", "document_id")
    ON DELETE CASCADE ON UPDATE CASCADE
    NOT VALID;
