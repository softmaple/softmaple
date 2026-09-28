import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

/** Sends signed-in visitors on from pages meant for signed-out ones. */
export async function AuthGuard({
  children,
  redirectTo = "/dashboard",
}: {
  children: React.ReactNode;
  redirectTo?: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error === null && data.user !== null) redirect(redirectTo);
  return children;
}
