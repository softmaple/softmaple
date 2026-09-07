import type { FC, ReactNode } from "react";
import Link from "next/link";
import type { DocsType } from "@/types/model";
import { SoftmapleWordmark } from "@/components/BrandMark";
import { WorkspaceNavigation } from "@/modules/workspaces/workspace-navigation";
import { WorkspaceDocsList } from "@/modules/workspaces/workspace-docs-list";

export type WorkspaceDesktopSidebarProps = {
  readonly canEdit: boolean;
  readonly children?: ReactNode;
  readonly documents: ReadonlyArray<DocsType["Row"]>;
  readonly workspaceSlug: string;
};

export const WorkspaceDesktopSidebar: FC<WorkspaceDesktopSidebarProps> = ({
  canEdit,
  children,
  documents,
  workspaceSlug,
}) => (
  <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar md:flex xl:w-72">
    <div className="p-5">
      <Link
        className="mb-4 inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        href="/dashboard"
      >
        <SoftmapleWordmark className="text-xl" />
      </Link>
      {children}
    </div>
    <WorkspaceNavigation workspaceSlug={workspaceSlug} />
    <WorkspaceDocsList
      canEdit={canEdit}
      documents={documents}
      workspaceSlug={workspaceSlug}
    />
  </aside>
);
