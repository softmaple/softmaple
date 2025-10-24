"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/model";

export const createClient = () =>
  createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
