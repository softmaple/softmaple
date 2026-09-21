import type { FC, ReactNode } from "react";
import Link from "next/link";
import type { DocsType, UsersType } from "@/types/model";
import { LandingBrand } from "@/components/landing/Brand";
import { WorkspaceAccountFooter } from "@/modules/workspaces/workspace-account-footer";
import { WorkspaceNavigation } from "@/modules/workspaces/workspace-navigation";
import { WorkspaceDocsList } from "@/modules/workspaces/workspace-docs-list";

export type WorkspaceDesktopSidebarProps = {
  readonly canEdit: boolean;
  readonly children?: ReactNode;
  readonly documents: ReadonlyArray<DocsType["Row"]>;
  readonly profile: Pick<
    UsersType["Row"],
    "avatar_alt" | "avatar_src" | "email" | "full_name"
  >;
  readonly workspaceSlug: string;
};

export const WorkspaceDesktopSidebar: FC<WorkspaceDesktopSidebarProps> = ({
  canEdit,
  children,
  documents,
  profile,
  workspaceSlug,
}) => (
  <aside className="workspace-left-rail hidden w-[15.5rem] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
    <div className="shrink-0 px-5 pb-3 pt-6">
      <Link
        aria-label="Softmaple dashboard"
        className="mb-6 inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        href="/dashboard"
      >
        <LandingBrand className="gap-2.5 text-[1.45rem] tracking-[-0.055em] [&_svg]:h-8 [&_svg]:w-7" />
      </Link>
      {children}
    </div>
    <WorkspaceDocsList
      canEdit={canEdit}
      documents={documents}
      navigation={<WorkspaceNavigation workspaceSlug={workspaceSlug} />}
      workspaceSlug={workspaceSlug}
    />
    <WorkspaceAccountFooter profile={profile} />
  </aside>
);
