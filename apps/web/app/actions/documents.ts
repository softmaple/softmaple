"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { cache } from "react";
import type { DocsType } from "@/types/model";

export const getDocumentBySlug = async (docSlug: string) => {
  if (!docSlug || typeof docSlug !== "string") {
    throw new Error("Invalid document slug.");
  }

  const supabase = await createClient();

  return supabase
    .from("documents")
    .select<string, DocsType["Row"]>("*")
    .eq("slug", docSlug)
    .maybeSingle();
};

export const cachedGetDocumentBySlug = cache(async (docSlug: string) =>
  getDocumentBySlug(docSlug),
);

export const createDocument = async (document: DocsType["Insert"]) => {
  const supabase = await createClient();

  return supabase
    .from("documents")
    .insert(document)
    .select<string, DocsType["Row"]>("*")
    .single();
};
