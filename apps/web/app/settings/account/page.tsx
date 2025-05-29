import { Profile } from "@/modules/settings/account/profile";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export default async function AccountSettingsPage() {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) {
    redirect("/login");
  }

  return <Profile userId={data.user.id} />;
}
