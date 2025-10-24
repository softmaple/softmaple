import { UsersType } from "@/types/model";

export const getUserFullname = (user: Partial<UsersType["Row"]>) => {
  const { first_name, last_name, full_name } = user;

  const fullName =
    full_name ||
    [first_name, last_name].filter(Boolean).join(" ") ||
    "Unknown User";

  return fullName;
};
