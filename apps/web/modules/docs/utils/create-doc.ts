"use client";

import type { DocsType } from "@/types/model";
import { clientCrud } from "@/utils/crud";

export const createDoc = async (newDoc: DocsType["Insert"]) => {
  try {
    return clientCrud.documents().create(newDoc);
  } catch (error) {
    console.error("Error creating document:", error);
    throw new Error("Failed to create document");
  }
};

export const upsertDoc = async (
  nextDoc: DocsType["Insert"] | DocsType["Update"],
) => {
  try {
    return clientCrud.documents().upsert(nextDoc);
  } catch (error) {
    console.error("Error upserting document:", error);
    throw new Error("Failed to upsert document");
  }
};
