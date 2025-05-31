"use server";

import { createClient } from "@/utils/supabase/server";
import type { Database } from "@softmaple/db";

type TableName = keyof Database["public"]["Tables"];

export const getAll = async <T extends TableName>(
  tableName: T,
  filter?: Record<string, any>,
  limit?: number,
  foreignTableName?: string,
) => {
  const supabase = await createClient();
  const query = supabase.from(tableName).select("*");

  if (limit) {
    query.limit(limit);
  }

  if (filter) {
    query.match(filter);
  }

  if (foreignTableName) {
    query.select(`*, ${foreignTableName} (*)`);
  }

  return query;
};

export const getDetailsBy = async () => {};
