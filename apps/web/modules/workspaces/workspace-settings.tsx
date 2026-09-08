"use client";

import { type FC, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Crown, LoaderCircle, Plus, Trash2, UserMinus } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import { Textarea } from "@softmaple/ui/components/textarea";
import { Badge } from "@softmaple/ui/components/badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@softmaple/ui/components/tabs";
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
import { deleteWorkspace, updateWorkspace } from "@/app/actions/workspaces";

type Workspace = WorkspacesType["Row"];

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

export const WorkspaceSettings: FC<{
  readonly initialTab: "general" | "members";
  readonly members: ReadonlyArray<WorkspaceMemberDirectoryEntry>;
  readonly role: WorkspaceRole;
  readonly workspace: Workspace;
}> = ({ initialTab, members, role, workspace }) => {
  const router = useRouter();
  const isOwner = role === WORKSPACE_ROLE.Owner;
  const [title, setTitle] = useState(workspace.title);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<ManageableWorkspaceRole>(
    WORKSPACE_ROLE.Editor,
  );
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const runMutation = (
    mutation: () => Promise<{ ok: boolean; message?: string }>,
  ) => {
    startTransition(async () => {
      const result = await mutation();
      if (!result.ok) {
        setMessage(result.message ?? "The change could not be saved.");
        return;
      }
      setMessage("Changes saved.");
      router.refresh();
    });
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-4xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-emphasis">
          Workspace control room
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold">Settings</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Manage durable workspace metadata and access. The workspace URL stays
          unchanged when its name changes.
        </p>

        {message === null ? null : (
          <p
            className="mt-5 border-l-2 border-primary bg-muted px-3 py-2 text-sm"
            role="status"
          >
            {message}
          </p>
        )}

        <Tabs className="mt-8" defaultValue={initialTab}>
          <TabsList className="max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="members">
              Members · {members.length}
            </TabsTrigger>
            {isOwner ? (
              <TabsTrigger value="danger">Danger zone</TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent
            className="mt-5 border bg-card p-5 sm:p-6"
            value="general"
          >
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                runMutation(() =>
                  updateWorkspace({
                    description,
                    title,
                    workspaceSlug: workspace.slug,
                  }),
                );
              }}
            >
              <div>
                <h2 className="font-display text-xl font-semibold">
                  Workspace details
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isOwner
                    ? "Only the owner can change these fields."
                    : "You can view these details; only the owner can edit them."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace-name">Name</Label>
                <Input
                  disabled={!isOwner || isPending}
                  id="workspace-name"
                  maxLength={80}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  value={title}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace-description">Description</Label>
                <Textarea
                  disabled={!isOwner || isPending}
                  id="workspace-description"
                  maxLength={500}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  value={description}
                />
              </div>
              {isOwner ? (
                <Button
                  disabled={isPending || title.trim().length === 0}
                  type="submit"
                >
                  {isPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : null}
                  Save workspace
                </Button>
              ) : null}
            </form>
          </TabsContent>

          <TabsContent className="mt-5 space-y-4" value="members">
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
                    <AvatarFallback>
                      {initials(member.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-36 flex-1">
                    <p className="text-sm font-medium">{member.full_name}</p>
                    {member.email === null ? null : (
                      <p className="text-xs text-muted-foreground">
                        {member.email}
                      </p>
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
                              role: event.target
                                .value as ManageableWorkspaceRole,
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
                    <Badge variant="secondary">
                      {member.role.toLowerCase()}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </TabsContent>

          {isOwner ? (
            <TabsContent
              className="mt-5 border border-destructive/40 bg-card p-5 sm:p-6"
              value="danger"
            >
              <div className="flex gap-3">
                <Trash2 className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-xl font-semibold">
                    Delete workspace
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Permanently deletes its documents and collaboration history.
                    Enter <strong>{workspace.title}</strong> to confirm.
                  </p>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <Input
                      aria-label="Workspace deletion confirmation"
                      disabled={isPending}
                      onChange={(event) => setConfirmation(event.target.value)}
                      value={confirmation}
                    />
                    <Button
                      disabled={isPending || confirmation !== workspace.title}
                      onClick={() => {
                        if (
                          !window.confirm("Delete this workspace permanently?")
                        )
                          return;
                        startTransition(async () => {
                          const result = await deleteWorkspace({
                            confirmation,
                            workspaceSlug: workspace.slug,
                          });
                          if (!result.ok) {
                            setMessage(result.message);
                            return;
                          }
                          router.replace("/dashboard");
                          router.refresh();
                        });
                      }}
                      variant="destructive"
                    >
                      Delete workspace
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>
          ) : null}
        </Tabs>
      </div>
    </main>
  );
};
