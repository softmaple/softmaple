"use server";

import { createClient } from "@/utils/supabase/server";

export const getAll = async (
  tableName: string,
  limit?: number,
  foreignTableName?: string,
) => {
  const supabase = await createClient();
  const query = supabase.from(tableName).select("*");

  if (limit) {
    query.limit(limit);
  }

  if (foreignTableName) {
    query.select(`*, ${foreignTableName} (*)`);
  }

  return query;
};

export const getDetailsBy = async () => {};
