"use client";

import { type FC, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, Plus, UserMinus } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import { Badge } from "@softmaple/ui/components/badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import type { WorkspacesType } from "@/types/model";
import {
  addWorkspaceMember,
  removeWorkspaceMember,
  setWorkspaceMemberRole,
} from "@/app/actions/workspaceMembers";
import {
  WORKSPACE_ROLE,
  type ManageableWorkspaceRole,
  type WorkspaceMemberDirectoryEntry,
  type WorkspaceRole,
} from "@/lib/workspace-roles";

type Workspace = WorkspacesType["Row"];

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

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
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const runMutation = (
    mutation: () => Promise<{ ok: boolean; message?: string }>,
  ) => {
    if (isPending) return;
    startTransition(async () => {
      try {
        const result = await mutation();
        setMessage(
          result.ok
            ? "Changes saved."
            : (result.message ?? "The change could not be saved."),
        );
        if (result.ok) router.refresh();
      } catch {
        setMessage("The change could not be saved. Please try again.");
      }
    });
  };
  return (
    <section className="flex flex-col gap-4" aria-label="Workspace members">
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
      {isOwner ? (
        <form
          className="grid gap-3 border bg-card p-4 sm:grid-cols-[1fr_8rem_auto]"
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
          <div className="space-y-2">
            <Label htmlFor="member-email">Registered account email</Label>
            <Input
              disabled={isPending}
              id="member-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@example.com"
              required
              type="email"
              value={email}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-role">Role</Label>
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              disabled={isPending}
              id="member-role"
              onChange={(event) =>
                setNewRole(event.target.value as ManageableWorkspaceRole)
              }
              value={newRole}
            >
              <option value={WORKSPACE_ROLE.Editor}>Editor</option>
              <option value={WORKSPACE_ROLE.Viewer}>Viewer</option>
            </select>
          </div>
          <Button className="self-end" disabled={isPending} type="submit">
            <Plus className="size-4" /> Add
          </Button>
        </form>
      ) : null}

      <div className="divide-y border bg-card">
        {members.map((member) => (
          <div
            className="flex flex-wrap items-center gap-3 p-4"
            key={member.member_id}
          >
            <Avatar className="size-9">
              <AvatarImage alt="" src={member.avatar_src ?? undefined} />
              <AvatarFallback>{initials(member.full_name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-36 flex-1">
              <p className="text-sm font-medium">{member.full_name}</p>
              {member.email === null ? null : (
                <p className="text-xs text-muted-foreground">{member.email}</p>
              )}
            </div>
            {member.role === WORKSPACE_ROLE.Owner ? (
              <Badge variant="outline">
                <Crown className="size-3" /> Owner
              </Badge>
            ) : isOwner ? (
              <>
                <select
                  aria-label={`Role for ${member.full_name}`}
                  className="h-8 rounded-md border bg-background px-2 text-xs"
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
                >
                  <option value={WORKSPACE_ROLE.Editor}>Editor</option>
                  <option value={WORKSPACE_ROLE.Viewer}>Viewer</option>
                </select>
                <Button
                  aria-label={`Remove ${member.full_name}`}
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
                  size="icon-sm"
                  variant="ghost"
                >
                  <UserMinus className="size-4" />
                </Button>
              </>
            ) : (
              <Badge variant="secondary">{member.role.toLowerCase()}</Badge>
            )}
          </div>
        ))}
      </div>
    </section>
  );
};
