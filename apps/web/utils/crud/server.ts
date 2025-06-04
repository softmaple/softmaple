"use server";

import { createClient } from "@/utils/supabase/server";
import type {
  TableName,
  BaseCrudOperations,
  CrudFilter,
  CrudOptions,
  CreateOptions,
  UpdateOptions,
  DeleteOptions,
  CrudResult,
  CrudListResult,
} from "@/types/crud";
import type { Table } from "@/types/model";

const createGetAllFunction =
  <T extends TableName>(tableName: T) =>
  async (
    options: CrudOptions = {},
  ): Promise<CrudListResult<Table<T>["Row"]>> => {
    try {
      const supabase = await createClient();
      let query = supabase.from(tableName).select(options.select || "*");

      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.offset) {
        query = query.range(
          options.offset,
          options.offset + (options.limit || 10) - 1,
        );
      }

      if (options.orderBy) {
        query = query.order(options.orderBy.column, {
          ascending: options.orderBy.ascending ?? true,
        });
      }

      return (await query) as any;
    } catch (error) {
      console.error(`Error fetching all ${tableName}:`, error);
      return { data: null, error };
    }
  };

const createGetByIdFunction =
  <T extends TableName>(tableName: T) =>
  async (id: string | number): Promise<CrudResult<Table<T>["Row"]>> => {
    try {
      const supabase = await createClient();
      return await supabase
        .from(tableName)
        .select("*")
        .eq("id", id)
        .maybeSingle();
    } catch (error) {
      console.error(`Error fetching ${tableName} by id:`, error);
      return { data: null, error };
    }
  };

const createGetByFunction =
  <T extends TableName>(tableName: T) =>
  async (
    filter: CrudFilter,
    options: CrudOptions = {},
  ): Promise<CrudListResult<Table<T>["Row"]>> => {
    try {
      const supabase = await createClient();
      let query = supabase
        .from(tableName)
        .select(options.select || "*")
        .match(filter);

      if (options.limit) {
        query = query.limit(options.limit);
      }

      if (options.orderBy) {
        query = query.order(options.orderBy.column, {
          ascending: options.orderBy.ascending ?? true,
        });
      }

      return (await query) as any;
    } catch (error) {
      console.error(`Error fetching ${tableName} by filter:`, error);
      return { data: null, error };
    }
  };

const createGetOneByFunction =
  <T extends TableName>(tableName: T) =>
  async (filter: CrudFilter): Promise<CrudResult<Table<T>["Row"]>> => {
    try {
      const supabase = await createClient();
      return await supabase
        .from(tableName)
        .select("*")
        .match(filter)
        .maybeSingle();
    } catch (error) {
      console.error(`Error fetching one ${tableName} by filter:`, error);
      return { data: null, error };
    }
  };

const createCreateFunction =
  <T extends TableName>(tableName: T) =>
  async (
    data: Table<T>["Insert"],
    options: CreateOptions<T> = {},
  ): Promise<CrudResult<Table<T>["Row"]>> => {
    try {
      const supabase = await createClient();
      let query = supabase
        .from(tableName)
        .insert(data)
        .select(options.select || "*");

      if (options.single) {
        return (await query.single()) as any;
      } else {
        return (await query.maybeSingle()) as any;
      }
    } catch (error) {
      console.error(`Error creating ${tableName}:`, error);
      return { data: null, error };
    }
  };

const createUpdateFunction =
  <T extends TableName>(tableName: T) =>
  async (
    id: string | number,
    data: Table<T>["Update"],
    options: UpdateOptions<T> = {},
  ): Promise<CrudResult<Table<T>["Row"]>> => {
    try {
      const supabase = await createClient();
      let query = supabase
        .from(tableName)
        .update(data)
        .eq("id", id)
        .select(options.select || "*");

      if (options.single) {
        return (await query.single()) as any;
      } else {
        return (await query.maybeSingle()) as any;
      }
    } catch (error) {
      console.error(`Error updating ${tableName}:`, error);
      return { data: null, error };
    }
  };

const createUpsertFunction =
  <T extends TableName>(tableName: T) =>
  async (
    data: Table<T>["Insert"] | Table<T>["Update"],
    options: CreateOptions<T> = {},
  ): Promise<CrudResult<Table<T>["Row"]>> => {
    try {
      const supabase = await createClient();
      let query = supabase
        .from(tableName)
        .upsert(data)
        .select(options.select || "*");

      if (options.single) {
        return (await query.single()) as any;
      } else {
        return (await query.maybeSingle()) as any;
      }
    } catch (error) {
      console.error(`Error upserting ${tableName}:`, error);
      return { data: null, error };
    }
  };

const createDeleteFunction =
  <T extends TableName>(tableName: T) =>
  async (
    id: string | number,
    options: DeleteOptions = {},
  ): Promise<CrudResult<Table<T>["Row"]>> => {
    try {
      const supabase = await createClient();
      return await supabase
        .from(tableName)
        .delete()
        .eq("id", id)
        .select(options.select || "*")
        .maybeSingle();
    } catch (error) {
      console.error(`Error deleting ${tableName}:`, error);
      return { data: null, error };
    }
  };

export const createServerCrud = <T extends TableName>(
  tableName: T,
): BaseCrudOperations<T> => ({
  getAll: createGetAllFunction(tableName),
  getById: createGetByIdFunction(tableName),
  getBy: createGetByFunction(tableName),
  getOneBy: createGetOneByFunction(tableName),
  create: createCreateFunction(tableName),
  update: createUpdateFunction(tableName),
  upsert: createUpsertFunction(tableName),
  delete: createDeleteFunction(tableName),
});
