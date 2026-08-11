-- Cloudflare collaboration keeps Postgres as the durable event source of
-- truth. These narrowly-scoped RPCs let the Worker reuse the existing
-- append/repair invariants through Supabase's Data API without exposing the
-- event tables to browser roles.

CREATE OR REPLACE FUNCTION public.append_document_event_batches(
    p_document_id UUID,
    p_actor_id UUID,
    p_batches JSONB
)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_available_event_ids TEXT[] := ARRAY[]::TEXT[];
    v_batch JSONB;
    v_batch_id TEXT;
    v_batch_ids TEXT[] := ARRAY[]::TEXT[];
    v_batch_row_id BIGINT;
    v_duplicate_event_ids TEXT[];
    v_event JSONB;
    v_existing_hash TEXT;
    v_member_role TEXT;
    v_missing_parent_ids TEXT[];
    v_parent_id TEXT;
    v_payload JSONB;
    v_payload_hash TEXT;
    v_required_parent_ids TEXT[];
    v_seen_in_batch TEXT[];
BEGIN
    IF jsonb_typeof(p_batches) IS DISTINCT FROM 'array'
        OR jsonb_array_length(p_batches) NOT BETWEEN 1 AND 64 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = jsonb_build_object(
                'kind', 'unavailable',
                'message', 'batches must contain between 1 and 64 event batches'
            )::TEXT;
    END IF;

    SELECT COALESCE(array_agg(duplicate.event_id ORDER BY duplicate.event_id), ARRAY[]::TEXT[])
    INTO v_duplicate_event_ids
    FROM (
        SELECT event_value->>'id' AS event_id
        FROM jsonb_array_elements(p_batches) AS batch_value
        CROSS JOIN LATERAL jsonb_array_elements(batch_value->'payload'->'events') AS event_value
        GROUP BY event_value->>'id'
        HAVING count(*) > 1
    ) AS duplicate;

    IF cardinality(v_duplicate_event_ids) > 0 THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = jsonb_build_object(
                'kind', 'conflict',
                'conflictType', 'duplicate-incoming-event-id',
                'documentId', p_document_id,
                'eventIds', to_jsonb(v_duplicate_event_ids)
            )::TEXT;
    END IF;

    -- This is the same transaction-scoped key used by the Nitro/Prisma host,
    -- so mixed PoC traffic cannot bypass document-wide serialization.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_document_id::TEXT, 0));

    -- Match the Nitro transaction's row lock so a concurrent membership
    -- revocation cannot commit between authorization and the event append.
    SELECT member.role::TEXT
    INTO v_member_role
    FROM public.workspace_members AS member
    INNER JOIN public.documents AS document
        ON document.workspace_id = member.workspace_id
    WHERE document.id = p_document_id
      AND member.user_id = p_actor_id
    FOR SHARE OF member;

    IF v_member_role IS NULL OR v_member_role NOT IN ('OWNER', 'EDITOR') THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = jsonb_build_object(
                'kind', 'authorization',
                'message', 'actor no longer has document write access'
            )::TEXT;
    END IF;

    FOR v_batch IN SELECT value FROM jsonb_array_elements(p_batches)
    LOOP
        v_payload := v_batch->'payload';
        v_payload_hash := v_batch->>'payloadHash';
        v_batch_id := v_payload->>'batchId';
        v_required_parent_ids := ARRAY[]::TEXT[];
        v_seen_in_batch := ARRAY[]::TEXT[];

        IF jsonb_typeof(v_payload) IS DISTINCT FROM 'object'
            OR COALESCE(v_batch_id, '') = ''
            OR COALESCE(v_payload_hash, '') !~ '^[0-9a-f]{64}$' THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = jsonb_build_object(
                    'kind', 'unavailable',
                    'message', 'invalid event batch payload'
                )::TEXT;
        END IF;

        FOR v_parent_id IN
            SELECT value
            FROM jsonb_array_elements_text(COALESCE(v_payload->'parentVersion', '[]'::JSONB))
        LOOP
            IF v_parent_id <> 'softmaple:block-model:bootstrap:event:v1'
                AND NOT (v_parent_id = ANY(v_available_event_ids)) THEN
                v_required_parent_ids := array_append(v_required_parent_ids, v_parent_id);
            END IF;
        END LOOP;

        FOR v_event IN
            SELECT value
            FROM jsonb_array_elements(COALESCE(v_payload->'events', '[]'::JSONB))
        LOOP
            FOR v_parent_id IN
                SELECT value
                FROM jsonb_array_elements_text(COALESCE(v_event->'parentVersion', '[]'::JSONB))
            LOOP
                IF v_parent_id <> 'softmaple:block-model:bootstrap:event:v1'
                    AND NOT (v_parent_id = ANY(v_available_event_ids))
                    AND NOT (v_parent_id = ANY(v_seen_in_batch)) THEN
                    v_required_parent_ids := array_append(v_required_parent_ids, v_parent_id);
                END IF;
            END LOOP;
            v_seen_in_batch := array_append(v_seen_in_batch, v_event->>'id');
        END LOOP;

        SELECT COALESCE(array_agg(required.parent_id ORDER BY required.parent_id), ARRAY[]::TEXT[])
        INTO v_missing_parent_ids
        FROM (
            SELECT DISTINCT unnest(v_required_parent_ids) AS parent_id
        ) AS required
        WHERE NOT EXISTS (
            SELECT 1
            FROM public.document_event_ids AS stored
            WHERE stored.document_id = p_document_id
              AND stored.event_id = required.parent_id
        );

        IF cardinality(v_missing_parent_ids) > 0 THEN
            RAISE EXCEPTION USING
                ERRCODE = 'P0001',
                MESSAGE = jsonb_build_object(
                    'kind', 'conflict',
                    'conflictType', 'missing-parent-history',
                    'documentId', p_document_id,
                    'batchIds', jsonb_build_array(v_batch_id),
                    'missingParentIds', to_jsonb(v_missing_parent_ids)
                )::TEXT;
        END IF;

        SELECT batch.payload_hash
        INTO v_existing_hash
        FROM public.document_event_batches AS batch
        WHERE batch.document_id = p_document_id
          AND batch.batch_id = v_batch_id;

        IF FOUND THEN
            IF v_existing_hash <> v_payload_hash THEN
                RAISE EXCEPTION USING
                    ERRCODE = 'P0001',
                    MESSAGE = jsonb_build_object(
                        'kind', 'conflict',
                        'conflictType', 'batch-payload-conflict',
                        'documentId', p_document_id,
                        'batchIds', jsonb_build_array(v_batch_id)
                    )::TEXT;
            END IF;
        ELSE
            BEGIN
                INSERT INTO public.document_event_batches (
                    document_id,
                    batch_id,
                    schema_version,
                    parent_version,
                    payload,
                    payload_hash,
                    actor_id
                )
                VALUES (
                    p_document_id,
                    v_batch_id,
                    (v_payload->>'schemaVersion')::INTEGER,
                    ARRAY(
                        SELECT value
                        FROM jsonb_array_elements_text(v_payload->'parentVersion')
                    ),
                    v_payload,
                    v_payload_hash,
                    p_actor_id
                )
                RETURNING id INTO v_batch_row_id;

                INSERT INTO public.document_event_ids (
                    document_id,
                    event_id,
                    batch_row_id
                )
                SELECT
                    p_document_id,
                    event_value->>'id',
                    v_batch_row_id
                FROM jsonb_array_elements(v_payload->'events') AS event_value;
            EXCEPTION WHEN unique_violation THEN
                RAISE EXCEPTION USING
                    ERRCODE = 'P0001',
                    MESSAGE = jsonb_build_object(
                        'kind', 'conflict',
                        'conflictType', 'stored-event-id-conflict',
                        'documentId', p_document_id,
                        'batchIds', jsonb_build_array(v_batch_id),
                        'eventIds', to_jsonb(v_seen_in_batch)
                    )::TEXT;
            END;
        END IF;

        v_available_event_ids := v_available_event_ids || v_seen_in_batch;
        v_batch_ids := array_append(v_batch_ids, v_batch_id);
    END LOOP;

    RETURN v_batch_ids;
END;
$$;

CREATE OR REPLACE FUNCTION public.read_document_event_page(
    p_document_id UUID,
    p_after_cursor BIGINT,
    p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
    WITH requested AS (
        SELECT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100) AS page_size
    ),
    rows AS (
        SELECT
            batch.id,
            batch.payload,
            row_number() OVER (ORDER BY batch.id) AS row_index
        FROM public.document_event_batches AS batch
        CROSS JOIN requested
        WHERE batch.document_id = p_document_id
          AND batch.id > p_after_cursor
        ORDER BY batch.id
        LIMIT (SELECT page_size + 1 FROM requested)
    )
    SELECT jsonb_build_object(
        'batches', COALESCE(
            jsonb_agg(rows.payload ORDER BY rows.id)
                FILTER (WHERE rows.row_index <= requested.page_size),
            '[]'::JSONB
        ),
        'nextCursor', COALESCE(
            (max(rows.id) FILTER (WHERE rows.row_index <= requested.page_size))::TEXT,
            p_after_cursor::TEXT
        ),
        'complete', count(rows.id) <= requested.page_size
    )
    FROM requested
    LEFT JOIN rows ON TRUE
    GROUP BY requested.page_size;
$$;

REVOKE ALL ON FUNCTION public.append_document_event_batches(UUID, UUID, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_document_event_batches(UUID, UUID, JSONB) FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.read_document_event_page(UUID, BIGINT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.read_document_event_page(UUID, BIGINT, INTEGER) FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT ON TABLE
    public.documents,
    public.workspace_members,
    public.document_event_batches,
    public.document_event_ids
TO service_role;
GRANT INSERT ON TABLE
    public.document_event_batches,
    public.document_event_ids
TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.document_event_batches_id_seq TO service_role;
GRANT EXECUTE ON FUNCTION public.append_document_event_batches(UUID, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_document_event_page(UUID, BIGINT, INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';
