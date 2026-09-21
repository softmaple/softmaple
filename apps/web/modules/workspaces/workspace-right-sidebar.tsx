import type { FC } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import { Button } from "@softmaple/ui/components/button";
import { Separator } from "@softmaple/ui/components/separator";
import type { WorkspaceMemberDirectoryEntry } from "@/lib/workspace-roles";
import { WORKSPACE_ROLE } from "@/lib/workspace-roles";
import { WorkspaceBrandPanel } from "@/modules/workspaces/workspace-brand-panel";

export type WorkspaceRightSidebarProps = {
  readonly canManageMembers: boolean;
  readonly members: ReadonlyArray<WorkspaceMemberDirectoryEntry>;
  readonly workspaceSlug: string;
};

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

export const WorkspaceRightSidebar: FC<WorkspaceRightSidebarProps> = ({
  canManageMembers,
  members,
  workspaceSlug,
}) => (
  <aside className="workspace-right-rail hidden w-[17rem] shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground min-[1360px]:flex">
    {members.length === 0 ? null : (
      <section
        aria-labelledby="workspace-people-heading"
        className="px-6 pb-6 pt-8"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2
              className="font-display text-xl font-semibold tracking-[-0.035em]"
              id="workspace-people-heading"
            >
              Your people
            </h2>
            <p className="text-xs text-muted-foreground">
              {members.length} {members.length === 1 ? "member" : "members"}
            </p>
          </div>
          {canManageMembers ? (
            <Button asChild size="sm" variant="ghost">
              <Link
                href={`/workspace/${workspaceSlug}/settings?tab=members`}
                prefetch={false}
              >
                Manage
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          ) : null}
        </div>
        <div className="mt-5 flex flex-col gap-2">
          {members.slice(0, 8).map((member) => (
            <div
              className="flex min-w-0 items-center gap-3 py-1.5"
              key={member.member_id}
            >
              <Avatar className="size-10 shrink-0 border border-sidebar-border">
                <AvatarImage alt="" src={member.avatar_src ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {initials(member.full_name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {member.full_name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.role === WORKSPACE_ROLE.Owner
                    ? "Workspace owner"
                    : member.role.toLowerCase()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    )}
    {members.length === 0 ? null : <Separator />}
    <WorkspaceBrandPanel />
  </aside>
);
