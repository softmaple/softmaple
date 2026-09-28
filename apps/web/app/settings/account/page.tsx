import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { getCurrentProfile } from "@/app/actions/users";
import {
  authLinkErrorMessage,
  resetLinkError,
} from "@/modules/auth/auth-link-errors";
import { Profile } from "@/modules/settings/account/profile";
import { WorkspaceHeader } from "@/modules/workspaces/workspace-paper";
import { paperSurface } from "@/modules/workspaces/workspace-paper-styles";

export const metadata: Metadata = {
  title: "Account settings",
  description: "Manage your Softmaple profile and preferences.",
};

interface AccountSettingsPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function AccountSettingsPage({
  searchParams,
}: AccountSettingsPageProps) {
  const [profile, params] = await Promise.all([
    getCurrentProfile(),
    searchParams,
  ]);
  if (!profile.ok) redirect("/login?next=/settings/account");
  return (
    <div className={`${paperSurface} min-h-dvh`}>
      <WorkspaceHeader signOut={logout} profile={profile.data} />
      <Profile
        initialProfile={profile.data}
        resetLinkError={authLinkErrorMessage(resetLinkError(params.error))}
      />
    </div>
  );
}
