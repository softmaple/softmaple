import { logout } from "@/app/actions/auth";
import { paperSurface } from "@/modules/workspaces/workspace-paper-styles";
import { getCurrentProfile } from "@/app/actions/users";
import { WorkspaceHeader } from "@/modules/workspaces/workspace-paper";
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  return (
    <div className={`${paperSurface} min-h-dvh`}>
      <WorkspaceHeader
        signOut={logout}
        profile={profile.ok ? profile.data : undefined}
      />
      {children}
    </div>
  );
}
