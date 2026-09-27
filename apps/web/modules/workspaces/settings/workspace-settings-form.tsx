import { Trash2, Upload } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import { Textarea } from "@softmaple/ui/components/textarea";
import type { WorkspacesType } from "@/types/model";
import { paperSerif, WorkspaceIcon } from "../workspace-paper";
import type { WorkspaceSettingsState } from "./use-workspace-settings";

const fieldRow =
  "grid gap-2 border-border py-1.5 md:py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] md:gap-8 md:border-b md:last:border-0";

export function WorkspaceSettingsForm({
  workspace,
  settings,
}: {
  workspace: WorkspacesType["Row"];
  settings: WorkspaceSettingsState;
}) {
  const {
    saved,
    title,
    setTitle,
    description,
    setDescription,
    isOwner,
    isPending,
    dirty,
    valid,
    workspaceHref,
    reset,
    save,
    setConfirmation,
    setFeedback,
    setDeleteOpen,
  } = settings;
  return (
    <>
      <form
        id="workspace-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div className="md:rounded-md md:border md:border-border md:px-5 md:py-1">
          <div className={fieldRow}>
            <div>
              <p className="text-sm font-semibold">Workspace icon</p>
              <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                Give your workspace a familiar face.
              </p>
            </div>
            <div className="flex items-center gap-5">
              <WorkspaceIcon
                title={saved.title}
                src={workspace.avatar_src}
                className="size-18 md:size-14"
              />
              <div>
                <Button variant="outline" disabled className="h-10">
                  <Upload data-icon="inline-start" />
                  Upload image
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Image uploads coming soon.
                </p>
              </div>
            </div>
          </div>
          <div className={fieldRow}>
            <Label
              className="self-start pt-1 text-sm font-semibold"
              htmlFor="workspace-name"
            >
              Workspace name
            </Label>
            <div>
              <Input
                className="h-10 md:h-8"
                id="workspace-name"
                maxLength={80}
                disabled={!isOwner || isPending}
                required
                value={title}
                aria-invalid={!title.trim()}
                aria-describedby={
                  !title.trim() ? "workspace-name-error" : undefined
                }
                onChange={(event) => setTitle(event.target.value)}
              />
              {!title.trim() ? (
                <p
                  className="mt-1 text-xs text-destructive"
                  id="workspace-name-error"
                >
                  Workspace name is required.
                </p>
              ) : null}
            </div>
          </div>
          <div className={fieldRow}>
            <Label
              className="self-start pt-1 text-sm font-semibold"
              htmlFor="workspace-description"
            >
              Description
            </Label>
            <Textarea
              className="min-h-14 md:min-h-12"
              id="workspace-description"
              rows={2}
              maxLength={500}
              disabled={!isOwner || isPending}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className={fieldRow}>
            <div>
              <Label className="text-sm font-semibold" htmlFor="workspace-url">
                Workspace URL
              </Label>
              <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                This link stays the same when renamed.
              </p>
            </div>
            <div className="flex min-w-0 items-stretch overflow-hidden rounded-md border border-input text-xs">
              <span className="flex shrink-0 items-center border-r border-input bg-muted/70 px-3 text-muted-foreground">
                /workspace/
              </span>
              <input
                id="workspace-url"
                className="h-10 min-w-0 flex-1 bg-transparent px-3 md:h-8"
                value={workspace.slug}
                readOnly
                title={`${workspaceHref} (read-only)`}
              />
            </div>
          </div>
        </div>
        <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-border bg-background px-6 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))] md:static md:justify-end md:border-0 md:bg-transparent md:px-0 md:py-3">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 md:h-9 md:flex-none md:min-w-24"
            disabled={!dirty || isPending}
            onClick={reset}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="h-11 flex-[1.5] md:h-9 md:flex-none md:min-w-36"
            disabled={!isOwner || !dirty || !valid || isPending}
          >
            {isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
      {!isOwner ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Only workspace owners can edit these details or delete this workspace.
        </p>
      ) : null}
      <section
        aria-label="Danger zone"
        className="mt-3 border-t border-border pt-4 md:rounded-md md:border md:border-destructive/40 md:px-5 md:py-3"
      >
        <h2
          className={`${paperSerif} mb-2 hidden text-lg text-destructive md:block`}
        >
          Danger zone
        </h2>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3
              className={`${paperSerif} text-lg text-destructive md:font-sans md:text-sm md:font-medium md:text-foreground`}
            >
              Delete workspace
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Permanently delete this workspace and its documents.
            </p>
          </div>
          <Button
            className="h-11 self-start border-destructive text-destructive md:h-9 md:self-center"
            variant="outline"
            disabled={!isOwner || isPending}
            onClick={() => {
              setConfirmation("");
              setFeedback(null);
              setDeleteOpen(true);
            }}
          >
            <Trash2 data-icon="inline-start" />
            Delete workspace
          </Button>
        </div>
      </section>
      <p className="mt-2 hidden text-right text-[11px] text-muted-foreground md:block">
        Only workspace owners can delete this workspace.
      </p>
    </>
  );
}
