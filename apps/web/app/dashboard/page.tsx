import { Dashboard } from "@/modules/dashboard/dashboard";
import { cachedGetWorkspaces } from "@/app/actions/workspaces";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your personal dashboard to manage workspaces and documents.",
};

export default async function DashboardPage() {
  const { data: workspaces, error } = await cachedGetWorkspaces();

  if (error) {
    console.error(error);
    redirect("/dashboard/error");
  }

  return <Dashboard workspaces={workspaces} />;
}
