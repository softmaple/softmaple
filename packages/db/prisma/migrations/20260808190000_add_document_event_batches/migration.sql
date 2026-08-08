-- Durable, append-only EG-walker history. The trusted collaboration service
-- writes through Prisma; these tables are intentionally unavailable through
-- the Supabase Data API roles.
CREATE TABLE "document_event_batches" (
    "id" BIGSERIAL NOT NULL,
    "document_id" UUID NOT NULL,
    "batch_id" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "parent_version" TEXT[] NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_event_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_event_ids" (
    "document_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "batch_row_id" BIGINT NOT NULL,

    CONSTRAINT "document_event_ids_pkey" PRIMARY KEY ("document_id", "event_id")
);

CREATE UNIQUE INDEX "document_event_batches_document_id_batch_id_key"
    ON "document_event_batches"("document_id", "batch_id");
CREATE INDEX "document_event_batches_document_id_id_idx"
    ON "document_event_batches"("document_id", "id");
CREATE INDEX "document_event_ids_batch_row_id_idx"
    ON "document_event_ids"("batch_row_id");

ALTER TABLE "document_event_batches"
    ADD CONSTRAINT "document_event_batches_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_event_ids"
    ADD CONSTRAINT "document_event_ids_batch_row_id_fkey"
    FOREIGN KEY ("batch_row_id") REFERENCES "document_event_batches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_event_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "document_event_ids" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "document_event_batches" FROM anon, authenticated;
REVOKE ALL ON TABLE "document_event_ids" FROM anon, authenticated;
REVOKE ALL ON SEQUENCE "document_event_batches_id_seq" FROM anon, authenticated;
