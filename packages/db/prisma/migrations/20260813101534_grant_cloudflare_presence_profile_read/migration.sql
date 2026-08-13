-- Presence authorization resolves the authenticated member's display profile
-- through Supabase's Data API. Data API grants are independent of RLS bypass,
-- so service_role needs explicit access to every selected/filter column.
GRANT SELECT (id, full_name, avatar_src)
    ON TABLE public.users TO service_role;

NOTIFY pgrst, 'reload schema';
