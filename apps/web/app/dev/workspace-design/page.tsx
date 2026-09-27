import { paperSurface } from "@/modules/workspaces/workspace-paper-styles";
import { notFound } from "next/navigation";
import { Dashboard } from "@/modules/dashboard/dashboard";
import { WorkspaceHome } from "@/modules/workspaces/workspace-home";
import { WorkspaceSettings } from "@/modules/workspaces/workspace-settings";
import { WorkspaceHeader } from "@/modules/workspaces/workspace-paper";

/** Explicit, local-only visual fixture. Never bypasses authenticated routes. */
export default async function WorkspaceDesignPreview({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; tab?: string; stress?: string }>;
}) {
  // NODE_ENV is supplied by Next.js itself, including direct `next dev` runs.
  // eslint-disable-next-line turbo/no-undeclared-env-vars
  if (process.env.NODE_ENV !== "development") notFound();
  const { homeFixture } = await import("@/modules/workspaces/home-fixture");
  const { page, tab, stress } = await searchParams;
  const base = homeFixture.workspaces[0]!;
  const workspaces = [
    {
      ...base,
      title: "Personal workspace",
      description: "Your own corner for notes and ideas.",
      memberCount: 1,
      documentCount: 12,
    },
    {
      ...base,
      id: 2,
      slug: "softmaple-studio",
      title: "Softmaple studio",
      description: "Good ideas, made together.",
      memberCount: 6,
      documentCount: 28,
      lastEditedAt: "2026-09-27",
    },
    {
      ...base,
      id: 3,
      slug: "weekend-ideas",
      title: "Weekend ideas",
      description: "A little room to explore.",
      memberCount: 3,
      documentCount: 8,
      lastEditedAt: "2026-09-26",
    },
  ];
  if (stress)
    workspaces[1] = {
      ...workspaces[1]!,
      title:
        "A very long workspace name for collaborative research and thoughtful ideas",
      slug: "a-very-long-workspace-slug-that-must-never-overflow-the-page-on-a-small-screen",
    };
  if (page === "settings")
    return (
      <WorkspaceSettings
        preview
        initialTab={tab === "members" ? "members" : "general"}
        workspace={workspaces[1]!}
        members={homeFixture.members}
        role="OWNER"
        profile={homeFixture.profile}
      />
    );
  if (page === "dashboard")
    return (
      <div className={`${paperSurface} min-h-dvh`}>
        <WorkspaceHeader profile={homeFixture.profile} />
        <Dashboard workspaces={workspaces} preview />
      </div>
    );
  const documents = homeFixture.documents.slice(0, 3).map((doc, index) => ({
    ...doc,
    title: [
      "Brand manifesto",
      "A few thoughts on together",
      "Little things, big ideas",
    ][index]!,
    displayTime: ["12 min ago", "2 hours ago", "yesterday"][index],
    people:
      index === 0
        ? homeFixture.members.slice(0, 2)
        : index === 1
          ? homeFixture.members.slice(0, 1)
          : [],
  }));
  if (stress)
    documents[0] = {
      ...documents[0]!,
      title:
        "A very long document title that should truncate without squeezing every other control out of its row",
    };
  return (
    <WorkspaceHome
      {...homeFixture}
      workspaces={workspaces}
      documents={documents}
      visualFixture={false}
    />
  );
}
