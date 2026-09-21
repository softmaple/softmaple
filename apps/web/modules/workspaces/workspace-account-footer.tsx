import type { FC } from "react";
import Link from "next/link";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import { Button } from "@softmaple/ui/components/button";
import { ModeToggle } from "@/components/mode-toggle";
import type { UsersType } from "@/types/model";

type WorkspaceAccount = Pick<
  UsersType["Row"],
  "avatar_alt" | "avatar_src" | "email" | "full_name"
>;

export type WorkspaceAccountFooterProps = {
  readonly onNavigate?: () => void;
  readonly profile: WorkspaceAccount;
};

const initials = (profile: WorkspaceAccount): string =>
  (profile.full_name || profile.email)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

export const WorkspaceAccountFooter: FC<WorkspaceAccountFooterProps> = ({
  onNavigate,
  profile,
}) => (
  <div className="flex shrink-0 items-center gap-1 border-t border-sidebar-border px-3 py-3.5">
    <Button
      asChild
      className="h-11 min-w-0 flex-1 justify-start px-2 text-left"
      variant="ghost"
    >
      <Link href="/settings/account" onClick={onNavigate}>
        <Avatar className="size-8 shrink-0 border border-sidebar-border">
          <AvatarImage
            alt={profile.avatar_alt ?? ""}
            src={profile.avatar_src ?? undefined}
          />
          <AvatarFallback className="text-xs">
            {initials(profile)}
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.84rem] font-medium">
            {profile.full_name || "Account"}
          </span>
          <span className="block truncate text-[0.68rem] text-muted-foreground">
            {profile.email}
          </span>
        </span>
      </Link>
    </Button>
    <ModeToggle className="size-11 border-sidebar-border bg-transparent shadow-none md:size-9" />
  </div>
);
