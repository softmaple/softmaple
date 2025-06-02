"use client";

import type { DocsType } from "@/types/model";
import { createClient } from "@/utils/supabase/client";
import { DOCUMENTS_TABLE } from "@/modules/docs/utils/constants/table";

export const createDoc = async (newDoc: DocsType) => {
  try {
    const supabase = createClient();

    const queryBuilder = supabase
      .from(DOCUMENTS_TABLE.name)
      .insert(newDoc)
      .select("*")
      .maybeSingle();

    return queryBuilder;
  } catch (error) {
    console.error("Error creating document:", error);
    throw new Error("Failed to create document");
  }
};

export const upsertDoc = async (nextDoc: DocsType) => {
  try {
    const supabase = createClient();

    const queryBuilder = supabase
      .from(DOCUMENTS_TABLE.name)
      .upsert(nextDoc)
      .select("*")
      .maybeSingle();

    return queryBuilder;
  } catch (error) {
    console.error("Error upserting document:", error);
    throw new Error("Failed to upsert document");
  }
};
