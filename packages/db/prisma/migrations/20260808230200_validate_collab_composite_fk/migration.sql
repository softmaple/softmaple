-- Run validation as a separate deployment step. NOT VALID already protects
-- new writes; validation checks pre-existing rows with a lighter lock.
ALTER TABLE "document_event_ids"
    VALIDATE CONSTRAINT
    "document_event_ids_batch_row_id_document_id_fkey";
