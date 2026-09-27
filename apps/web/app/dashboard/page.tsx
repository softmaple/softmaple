import { DashboardEntry } from "@/modules/dashboard/dashboard-entry";
import { cachedGetWorkspaces } from "@/app/actions/workspaces";
import { getCurrentProfile } from "@/app/actions/users";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your personal dashboard to manage workspaces and documents.",
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const [result, profile, { view }] = await Promise.all([
    cachedGetWorkspaces(),
    getCurrentProfile(),
    searchParams,
  ]);
  if (!result.ok) throw new Error(result.message);
  if (!profile.ok) throw new Error(profile.message);
  return (
    <DashboardEntry
      userId={profile.data.id}
      workspaces={result.data}
      showAll={view === "all"}
    />
  );
}
