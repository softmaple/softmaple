-- Keep this migration to one statement. PostgreSQL cannot run a concurrent
-- index build inside a transaction block, and Prisma 7.9 executes this
-- PostgreSQL migration without wrapping it in one. The index bounds recent
-- writing-activity reads to a document's own recent batches.
CREATE INDEX CONCURRENTLY
    "document_event_batches_document_id_created_at_idx"
    ON "document_event_batches"("document_id", "created_at");
