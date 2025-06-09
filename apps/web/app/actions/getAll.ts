"use server";

import { createServerCrud } from "@/utils/crud";
import type { TableName, CrudOptions, CrudFilter } from "@/utils/crud";

export const getAll = async <T extends TableName>(
  tableName: T,
  filter?: CrudFilter,
  limit?: number,
  foreignTableName?: string,
) => {
  const crud = createServerCrud(tableName);
  const options: CrudOptions = {
    limit,
    select: foreignTableName ? `*, ${foreignTableName} (*)` : "*",
  };

  return filter ? crud.getBy(filter, options) : crud.getAll(options);
};

export const getDetailsBy = async () => {};
