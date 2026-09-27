-- Workspace home "Happening now": which members wrote in which documents
-- during a recent window. The answer is derived from durable event batches,
-- so it is identical whichever collaboration runtime owns a document, and it
-- also covers private documents saved over HTTP. Ephemeral presence stays
-- runtime-local and is intentionally not consulted.
--
-- Event tables remain unavailable to Data API roles. This function exposes
-- activity metadata only (never payloads) to members of the workspace and
-- binds authorization to auth.uid(), like the other core behavior functions.
CREATE OR REPLACE FUNCTION public.list_workspace_writing_activity(
    p_workspace_id INTEGER,
    p_window_seconds INTEGER
)
RETURNS TABLE (
    document_id UUID,
    document_slug TEXT,
    document_title TEXT,
    user_id UUID,
    full_name TEXT,
    avatar_src TEXT,
    last_written_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    window_start TIMESTAMPTZ;
BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT private.is_workspace_member(p_workspace_id)
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '42501',
            MESSAGE = 'workspace_access_denied';
    END IF;

    IF p_window_seconds IS NULL
       OR p_window_seconds NOT BETWEEN 60 AND 3600
    THEN
        RAISE EXCEPTION USING
            ERRCODE = '22023',
            MESSAGE = 'invalid_activity_window';
    END IF;

    window_start := now() - make_interval(secs => p_window_seconds);

    RETURN QUERY
    SELECT
        document.id,
        document.slug,
        document.title,
        profile.id,
        COALESCE(NULLIF(profile.full_name, ''), 'Unnamed member'),
        profile.avatar_src,
        MAX(recent.created_at)
    FROM (
        -- Every appended batch touches documents.updated_at, so the workspace
        -- cursor index narrows the search to documents changed in the window.
        SELECT candidate.id, candidate.slug, candidate.title
        FROM public.documents AS candidate
        WHERE candidate.workspace_id = p_workspace_id
          AND candidate.updated_at >= window_start
        ORDER BY candidate.updated_at DESC, candidate.id DESC
        LIMIT 10
    ) AS document
    CROSS JOIN LATERAL (
        -- The (document_id, created_at) index reads only the window's own
        -- batches. The limit caps a runaway writer and keeps this a per-
        -- document index scan instead of a scan over every document's history.
        SELECT batch.actor_id, batch.created_at
        FROM public.document_event_batches AS batch
        WHERE batch.document_id = document.id
          AND batch.created_at >= window_start
        ORDER BY batch.created_at DESC
        LIMIT 2000
    ) AS recent
    -- Only current members are listed, so a removed account never surfaces.
    INNER JOIN public.workspace_members AS member
        ON member.workspace_id = p_workspace_id
       AND member.user_id = recent.actor_id
    INNER JOIN public.users AS profile ON profile.id = member.user_id
    GROUP BY
        document.id,
        document.slug,
        document.title,
        profile.id,
        profile.full_name,
        profile.avatar_src
    ORDER BY MAX(recent.created_at) DESC, document.id, profile.id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_workspace_writing_activity(INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_workspace_writing_activity(INTEGER, INTEGER)
    TO authenticated;

NOTIFY pgrst, 'reload schema';
