"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { cache } from "react";
import type { DocsType } from "@/types/model";
import { serverCrud } from "@/utils/crud";

export const getDocumentBySlug = async (docSlug: string) => {
  if (!docSlug || typeof docSlug !== "string") {
    throw new Error("Invalid document slug.");
  }

  return serverCrud.documents().getOneBy({ slug: docSlug });
};

export const cachedGetDocumentBySlug = cache(async (docSlug: string) =>
  getDocumentBySlug(docSlug),
);

export const createDocument = async (document: DocsType["Insert"]) => {
  try {
    const supabase = await createClient();

    return supabase
      .from("documents")
      .insert(document)
      .select<string, DocsType["Row"]>("*")
      .single();
  } catch (error) {
    console.error("Error creating document:", error);
    throw error;
  }
};
