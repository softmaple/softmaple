import { serverCrud } from "@/utils/crud";

export const getUserBy = async (filter: Record<string, any>) => {
  return serverCrud.users().getOneBy(filter);
};
