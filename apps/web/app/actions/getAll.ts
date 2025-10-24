"use server";

import { createClient } from "@/utils/supabase/server";
import { Table } from "@/types/model";

export const getAll = async (
  tableName: string,
  filter?: Record<string, any>,
  limit?: number,
  foreignTableName?: string,
) => {
  const supabase = await createClient();
  const query = supabase
    .from(tableName)
    // @ts-expect-error FIXME: Type 'string' is not assignable to type 'Table<"documents"> | Table<"workspace_members">'.
    .select<string, Table<typeof tableName>["Row"]>("*");

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
