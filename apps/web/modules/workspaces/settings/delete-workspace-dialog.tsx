import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@softmaple/ui/components/dialog";
import { paperSurface } from "../workspace-paper";
import type { WorkspaceSettingsState } from "./use-workspace-settings";

export function DeleteWorkspaceDialog({
  settings,
  preview,
}: {
  settings: WorkspaceSettingsState;
  preview: boolean;
}) {
  const {
    deleteOpen,
    setDeleteOpen,
    isPending,
    saved,
    confirmation,
    setConfirmation,
    feedback,
    remove,
  } = settings;
  return (
    <Dialog
      open={deleteOpen}
      onOpenChange={(open) => {
        if (!isPending) setDeleteOpen(open);
      }}
    >
      <DialogContent className={paperSurface}>
        <DialogTitle>Delete workspace</DialogTitle>
        <DialogDescription>
          This permanently deletes all documents and collaboration history.
          Enter “{saved.title}” to confirm.
        </DialogDescription>
        <Label htmlFor="delete-confirmation">Workspace name confirmation</Label>
        <Input
          id="delete-confirmation"
          disabled={isPending}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        {feedback?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {feedback.text}
          </p>
        ) : null}
        <Button
          variant="destructive"
          disabled={preview || confirmation !== saved.title || isPending}
          onClick={remove}
        >
          {isPending ? "Deleting…" : "Permanently delete workspace"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
