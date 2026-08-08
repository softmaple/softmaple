-- CreateTable
CREATE TABLE "document_event_batches" (
    "id" BIGSERIAL NOT NULL,
    "document_id" UUID NOT NULL,
    "batch_id" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "parent_version" TEXT[],
    "payload" JSONB NOT NULL,
    "payload_hash" CHAR(64) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_event_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_event_ids" (
    "document_id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,

    CONSTRAINT "document_event_ids_pkey" PRIMARY KEY ("document_id","event_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_event_batches_document_id_batch_id_key" ON "document_event_batches"("document_id", "batch_id");

-- CreateIndex
CREATE INDEX "document_event_batches_document_id_id_idx" ON "document_event_batches"("document_id", "id");

-- CreateIndex
CREATE INDEX "document_event_ids_document_id_batch_id_idx" ON "document_event_ids"("document_id", "batch_id");

-- AddForeignKey
ALTER TABLE "document_event_batches" ADD CONSTRAINT "document_event_batches_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_event_ids" ADD CONSTRAINT "document_event_ids_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_event_ids" ADD CONSTRAINT "document_event_ids_document_id_batch_id_fkey" FOREIGN KEY ("document_id", "batch_id") REFERENCES "document_event_batches"("document_id", "batch_id") ON DELETE CASCADE ON UPDATE CASCADE;
