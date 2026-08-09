import type { FC, ReactNode } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import type { DocsType } from "@/types/model";
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
  <aside className="hidden w-72 shrink-0 flex-col border-r bg-sidebar md:flex xl:w-80">
    <div className="border-b p-4">
      <Link className="mb-4 flex items-center gap-2" href="/dashboard">
        <span className="grid size-8 place-items-center rounded-sm border bg-background text-primary">
          <FileText className="size-4" />
        </span>
        <span className="font-display font-semibold">Softmaple</span>
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
