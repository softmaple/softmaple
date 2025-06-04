import type { Database, Table } from "./model";

export type TableName = keyof Database["public"]["Tables"];

export interface CrudFilter {
  [key: string]: any;
}

export interface CrudOptions {
  limit?: number;
  offset?: number;
  orderBy?: {
    column: string;
    ascending?: boolean;
  };
  select?: string;
}

export interface CreateOptions<T extends TableName> {
  select?: string;
  single?: boolean;
}

export interface UpdateOptions<T extends TableName> {
  select?: string;
  single?: boolean;
}

export interface DeleteOptions {
  select?: string;
}

export type CrudResult<T> = {
  data: T | null;
  error: any;
};

export type CrudListResult<T> = {
  data: T[] | null;
  error: any;
};

export interface BaseCrudOperations<T extends TableName> {
  getAll(options?: CrudOptions): Promise<CrudListResult<Table<T>["Row"]>>;
  getById(id: string | number): Promise<CrudResult<Table<T>["Row"]>>;
  getBy(
    filter: CrudFilter,
    options?: CrudOptions,
  ): Promise<CrudListResult<Table<T>["Row"]>>;
  getOneBy(filter: CrudFilter): Promise<CrudResult<Table<T>["Row"]>>;
  create(
    data: Table<T>["Insert"],
    options?: CreateOptions<T>,
  ): Promise<CrudResult<Table<T>["Row"]>>;
  update(
    id: string | number,
    data: Table<T>["Update"],
    options?: UpdateOptions<T>,
  ): Promise<CrudResult<Table<T>["Row"]>>;
  upsert(
    data: Table<T>["Insert"] | Table<T>["Update"],
    options?: CreateOptions<T>,
  ): Promise<CrudResult<Table<T>["Row"]>>;
  delete(
    id: string | number,
    options?: DeleteOptions,
  ): Promise<CrudResult<Table<T>["Row"]>>;
}
