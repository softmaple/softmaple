"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/model";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSupabasePublicConfig } from "./config";

export const createClient = (): SupabaseClient<Database> => {
  const { publishableKey, url } = resolveSupabasePublicConfig();
  return createBrowserClient<Database>(url, publishableKey);
};
