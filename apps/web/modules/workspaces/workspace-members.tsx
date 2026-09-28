"use client";

import { type ComponentProps, type FC, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Crown, Plus, UserMinus } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import { Badge } from "@softmaple/ui/components/badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import { cn } from "@softmaple/ui/lib/utils";
import type { WorkspacesType } from "@/types/model";
import {
  addWorkspaceMember,
  removeWorkspaceMember,
  setWorkspaceMemberRole,
} from "@/app/actions/workspaceMembers";
import {
  WORKSPACE_ROLE,
  WORKSPACE_ROLE_LABEL,
  type ManageableWorkspaceRole,
  type WorkspaceMemberDirectoryEntry,
  type WorkspaceRole,
} from "@/lib/workspace-roles";
import { PaperFeedback, type PaperFeedbackMessage } from "./workspace-paper";

type Workspace = WorkspacesType["Row"];

const MANAGEABLE_ROLES = [
  WORKSPACE_ROLE.Editor,
  WORKSPACE_ROLE.Viewer,
] as const;

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

/** A native select (keyboard, screen reader and e2e friendly) in the paper field style. */
function RoleSelect({
  className,
  ...props
}: Omit<ComponentProps<"select">, "children">) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        {...props}
        className="h-full w-full cursor-pointer appearance-none rounded-md border border-input bg-transparent pl-3 pr-8 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
      >
        {MANAGEABLE_ROLES.map((role) => (
          <option key={role} value={role}>
            {WORKSPACE_ROLE_LABEL[role]}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

export const WorkspaceMembers: FC<{
  readonly members: ReadonlyArray<WorkspaceMemberDirectoryEntry>;
  readonly role: WorkspaceRole;
  readonly workspace: Workspace;
}> = ({ members, role, workspace }) => {
  const router = useRouter();
  const isOwner = role === WORKSPACE_ROLE.Owner;
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<ManageableWorkspaceRole>(
    WORKSPACE_ROLE.Editor,
  );
  const [feedback, setFeedback] = useState<PaperFeedbackMessage | null>(null);
  const [isPending, startTransition] = useTransition();
  const runMutation = (
    mutation: () => Promise<{ ok: boolean; message?: string }>,
  ) => {
    if (isPending) return;
    startTransition(async () => {
      try {
        const result = await mutation();
        setFeedback(
          result.ok
            ? { error: false, text: "Changes saved." }
            : {
                error: true,
                text: result.message ?? "The change could not be saved.",
              },
        );
        if (result.ok) router.refresh();
      } catch {
        setFeedback({
          error: true,
          text: "The change could not be saved. Please try again.",
        });
      }
    });
  };
  return (
    <section className="flex flex-col gap-4" aria-label="Workspace members">
      <PaperFeedback feedback={feedback} />
      {isOwner ? (
        <form
          className="grid gap-3 rounded-md border border-border bg-card/70 p-4 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            runMutation(async () => {
              const result = await addWorkspaceMember({
                email,
                role: newRole,
                workspaceSlug: workspace.slug,
              });
              if (result.ok) setEmail("");
              return result;
            });
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="member-email">Registered account email</Label>
            <Input
              aria-describedby="member-email-hint"
              autoComplete="off"
              className="h-10 sm:h-9"
              disabled={isPending}
              id="member-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@example.com"
              required
              type="email"
              value={email}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="member-role">Role</Label>
            <RoleSelect
              className="h-10 w-full sm:h-9"
              disabled={isPending}
              id="member-role"
              onChange={(event) =>
                setNewRole(event.target.value as ManageableWorkspaceRole)
              }
              value={newRole}
            />
          </div>
          <Button className="h-10 sm:h-9" disabled={isPending} type="submit">
            <Plus data-icon="inline-start" />
            Add member
          </Button>
          <p
            className="text-xs leading-5 text-muted-foreground sm:col-span-3"
            id="member-email-hint"
          >
            People need a Softmaple account before they can be added. Invitation
            links are coming soon.
          </p>
        </form>
      ) : null}

      <ul className="divide-y divide-border rounded-md border border-border bg-card/70">
        {members.map((member) => (
          <li
            className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
            key={member.member_id}
          >
            <Avatar className="size-9">
              <AvatarImage alt="" src={member.avatar_src ?? undefined} />
              <AvatarFallback className="text-xs">
                {initials(member.full_name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{member.full_name}</p>
              {member.email === null ? null : (
                <p className="truncate text-xs text-muted-foreground">
                  {member.email}
                </p>
              )}
            </div>
            <div className="col-start-2 flex items-center gap-1 sm:col-start-auto sm:justify-end">
              {member.role === WORKSPACE_ROLE.Owner ? (
                <Badge variant="outline">
                  <Crown /> {WORKSPACE_ROLE_LABEL[member.role]}
                </Badge>
              ) : isOwner ? (
                <>
                  <RoleSelect
                    aria-label={`Role for ${member.full_name}`}
                    className="h-9 w-28"
                    disabled={isPending}
                    onChange={(event) =>
                      runMutation(() =>
                        setWorkspaceMemberRole({
                          memberId: member.member_id,
                          role: event.target.value as ManageableWorkspaceRole,
                          workspaceSlug: workspace.slug,
                        }),
                      )
                    }
                    value={member.role}
                  />
                  <Button
                    aria-label={`Remove ${member.full_name}`}
                    className="size-11 text-muted-foreground hover:text-destructive sm:size-9"
                    disabled={isPending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Remove ${member.full_name} from this workspace?`,
                        )
                      )
                        return;
                      runMutation(() =>
                        removeWorkspaceMember({
                          memberId: member.member_id,
                          workspaceSlug: workspace.slug,
                        }),
                      );
                    }}
                    size="icon"
                    title={`Remove ${member.full_name}`}
                    variant="ghost"
                  >
                    <UserMinus />
                  </Button>
                </>
              ) : (
                <Badge variant="secondary">
                  {WORKSPACE_ROLE_LABEL[member.role]}
                </Badge>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
