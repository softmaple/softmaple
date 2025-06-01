"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { cache } from "react";
import type { Document } from "@softmaple/db";

export const getDocumentBySlug = async (docSlug: string) => {
  if (!docSlug || typeof docSlug !== "string") {
    throw new Error("Invalid document slug.");
  }

  const supabase = await createClient();

  return supabase
    .from("documents")
    .select<string, Document>("*")
    .eq("slug", docSlug)
    .maybeSingle();
};

export const cachedGetDocumentBySlug = cache(async (docSlug: string) =>
  getDocumentBySlug(docSlug),
);
