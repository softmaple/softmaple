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
  // A flex column lets the page fill the space under the header exactly
  // (no calc against the header's height and border).
  return (
    <div className={`${paperSurface} flex min-h-dvh flex-col`}>
      <WorkspaceHeader
        signOut={logout}
        profile={profile.ok ? profile.data : undefined}
      />
      {children}
    </div>
  );
}
