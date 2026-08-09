import { redirect } from "next/navigation";
import { Profile } from "@/modules/settings/account/profile";
import { getCurrentProfile } from "@/app/actions/users";

export default async function AccountSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile.ok) redirect("/login?next=/settings/account");
  return <Profile initialProfile={profile.data} />;
}
