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

export class ServerCrud<T extends TableName> implements BaseCrudOperations<T> {
  constructor(private tableName: T) {}

  async getAll(
    options: CrudOptions = {},
  ): Promise<CrudListResult<Table<T>["Row"]>> {
    try {
      const supabase = await createClient();
      let query = supabase.from(this.tableName).select(options.select || "*");

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
      console.error(`Error fetching all ${this.tableName}:`, error);
      return { data: null, error };
    }
  }

  async getById(id: string | number): Promise<CrudResult<Table<T>["Row"]>> {
    try {
      const supabase = await createClient();
      return await supabase
        .from(this.tableName)
        .select("*")
        .eq("id", id)
        .maybeSingle();
    } catch (error) {
      console.error(`Error fetching ${this.tableName} by id:`, error);
      return { data: null, error };
    }
  }

  async getBy(
    filter: CrudFilter,
    options: CrudOptions = {},
  ): Promise<CrudListResult<Table<T>["Row"]>> {
    try {
      const supabase = await createClient();
      let query = supabase
        .from(this.tableName)
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
      console.error(`Error fetching ${this.tableName} by filter:`, error);
      return { data: null, error };
    }
  }

  async getOneBy(filter: CrudFilter): Promise<CrudResult<Table<T>["Row"]>> {
    try {
      const supabase = await createClient();
      return await supabase
        .from(this.tableName)
        .select("*")
        .match(filter)
        .maybeSingle();
    } catch (error) {
      console.error(`Error fetching one ${this.tableName} by filter:`, error);
      return { data: null, error };
    }
  }

  async create(
    data: Table<T>["Insert"],
    options: CreateOptions<T> = {},
  ): Promise<CrudResult<Table<T>["Row"]>> {
    try {
      const supabase = await createClient();
      let query = supabase
        .from(this.tableName)
        .insert(data)
        .select(options.select || "*");

      if (options.single) {
        return await query.single();
      } else {
        return await query.maybeSingle();
      }
    } catch (error) {
      console.error(`Error creating ${this.tableName}:`, error);
      return { data: null, error };
    }
  }

  async update(
    id: string | number,
    data: Table<T>["Update"],
    options: UpdateOptions<T> = {},
  ): Promise<CrudResult<Table<T>["Row"]>> {
    try {
      const supabase = await createClient();
      let query = supabase
        .from(this.tableName)
        .update(data)
        .eq("id", id)
        .select(options.select || "*");

      if (options.single) {
        return await query.single();
      } else {
        return await query.maybeSingle();
      }
    } catch (error) {
      console.error(`Error updating ${this.tableName}:`, error);
      return { data: null, error };
    }
  }

  async upsert(
    data: Table<T>["Insert"] | Table<T>["Update"],
    options: CreateOptions<T> = {},
  ): Promise<CrudResult<Table<T>["Row"]>> {
    try {
      const supabase = await createClient();
      let query = supabase
        .from(this.tableName)
        .upsert(data)
        .select(options.select || "*");

      if (options.single) {
        return await query.single();
      } else {
        return await query.maybeSingle();
      }
    } catch (error) {
      console.error(`Error upserting ${this.tableName}:`, error);
      return { data: null, error };
    }
  }

  async delete(
    id: string | number,
    options: DeleteOptions = {},
  ): Promise<CrudResult<Table<T>["Row"]>> {
    try {
      const supabase = await createClient();
      return await supabase
        .from(this.tableName)
        .delete()
        .eq("id", id)
        .select(options.select || "*")
        .maybeSingle();
    } catch (error) {
      console.error(`Error deleting ${this.tableName}:`, error);
      return { data: null, error };
    }
  }
}
