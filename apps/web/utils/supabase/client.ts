"use client";

import { createBrowserClient } from "@supabase/ssr";
import { createClient as createDClient } from "@supabase/supabase-js";

export const createClient = (): ReturnType<typeof createBrowserClient> =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

export const createQueryClient = createDClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
