import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { getCurrentProfile } from "@/app/actions/users";
import { Profile } from "@/modules/settings/account/profile";
import { WorkspaceHeader } from "@/modules/workspaces/workspace-paper";
import { paperSurface } from "@/modules/workspaces/workspace-paper-styles";

export const metadata: Metadata = {
  title: "Account settings",
  description: "Manage your Softmaple profile and preferences.",
};

export default async function AccountSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile.ok) redirect("/login?next=/settings/account");
  return (
    <div className={`${paperSurface} min-h-dvh`}>
      <WorkspaceHeader signOut={logout} profile={profile.data} />
      <Profile initialProfile={profile.data} />
    </div>
  );
}
