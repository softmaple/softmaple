import { createClient } from "@/utils/supabase/server";
import type { User } from "@softmaple/db";
import { serverCrud } from "@/utils/crud";

export const getUserBy = async (filter: Record<string, any>) => {
  return serverCrud.users().getOneBy(filter);
};
