"use client";

import type { DocsType } from "@/types/model";
import { createClient } from "@/utils/supabase/client";
import { DOCUMENTS_TABLE } from "@/utils/constants/tables";

export const createDoc = async (newDoc: DocsType["Insert"]) => {
  try {
    const supabase = createClient();

    const queryBuilder = supabase
      .from(DOCUMENTS_TABLE.name)
      .insert(newDoc)
      .select<string, DocsType["Row"]>("*")
      .maybeSingle();

    return queryBuilder;
  } catch (error) {
    console.error("Error creating document:", error);
    throw new Error("Failed to create document");
  }
};

export const upsertDoc = async (
  nextDoc: DocsType["Insert"] | DocsType["Update"],
) => {
  try {
    const supabase = createClient();

    const queryBuilder = supabase
      .from(DOCUMENTS_TABLE.name)
      .upsert(nextDoc)
      .select<string, DocsType["Row"]>("*")
      .maybeSingle();

    return queryBuilder;
  } catch (error) {
    console.error("Error upserting document:", error);
    throw new Error("Failed to upsert document");
  }
};
