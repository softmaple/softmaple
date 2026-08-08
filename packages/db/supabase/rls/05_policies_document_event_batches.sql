-- Collaboration event tables are service-only (Prisma / Collab WS).
-- Enable RLS and deny Data API access for anon + authenticated.

ALTER TABLE document_event_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_event_ids ENABLE ROW LEVEL SECURITY;

-- No policies for anon/authenticated → all row access denied when using the
-- Supabase Data API. The Collab service connects with the DB role via Prisma.

REVOKE ALL ON TABLE document_event_batches FROM anon, authenticated;
REVOKE ALL ON TABLE document_event_ids FROM anon, authenticated;
