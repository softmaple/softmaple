import { Dashboard } from "@/modules/dashboard/dashboard";
import { cachedGetWorkspaces } from "@/app/actions/workspaces";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your personal dashboard to manage workspaces and documents.",
};

export default async function DashboardPage() {
  const result = await cachedGetWorkspaces();
  if (!result.ok) throw new Error(result.message);
  return <Dashboard workspaces={result.data} />;
}
