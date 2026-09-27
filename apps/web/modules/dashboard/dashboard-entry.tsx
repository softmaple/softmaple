"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { WorkspaceSummary } from "@/app/actions/workspaces";
import { useDefaultWorkspace } from "@/modules/workspaces/use-default-workspace";
import { Dashboard } from "./dashboard";

export function DashboardEntry({
  userId,
  workspaces,
  showAll = false,
}: {
  userId: string;
  workspaces: WorkspaceSummary[];
  showAll?: boolean;
}) {
  const router = useRouter();
  const { workspaceId, isReady, setDefaultWorkspace } =
    useDefaultWorkspace(userId);
  // Resolve the stored ID against accessible server data, never a stored URL.
  const workspace =
    workspaces.find((item) => String(item.id) === workspaceId) ?? workspaces[0];
  const targetId = workspace?.id;
  const targetSlug = workspace?.slug;

  useEffect(() => {
    if (!isReady || showAll) return;
    setDefaultWorkspace(targetId ?? null);
    if (targetSlug) router.replace(`/workspace/${targetSlug}`);
  }, [isReady, showAll, targetId, targetSlug, setDefaultWorkspace, router]);

  if (showAll || workspaces.length === 0) {
    return <Dashboard workspaces={workspaces} />;
  }
  return (
    <main className="px-6 py-10" aria-busy="true">
      <p role="status" className="text-sm text-muted-foreground">
        Opening your workspace…
      </p>
    </main>
  );
}
