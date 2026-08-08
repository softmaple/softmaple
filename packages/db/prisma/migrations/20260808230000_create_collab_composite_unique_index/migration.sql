-- Keep this migration to one statement. PostgreSQL cannot run a concurrent
-- index build inside a transaction block, and Prisma 7.9 executes this
-- PostgreSQL migration without wrapping it in one.
CREATE UNIQUE INDEX CONCURRENTLY
    "document_event_batches_id_document_id_key"
    ON "document_event_batches"("id", "document_id");
