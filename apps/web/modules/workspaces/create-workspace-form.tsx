"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { Textarea } from "@softmaple/ui/components/textarea";
import { DialogFooter } from "@softmaple/ui/components/dialog";
import { createWorkspace } from "@/app/actions/workspaces";
import type { SubmitButtonProps } from "@/modules/workspaces/submit-button";
import { SubmitButton } from "@/modules/workspaces/submit-button";

export const CreateWorkspaceForm = ({
  onOpenChange,
  preview = false,
}: SubmitButtonProps & { preview?: boolean }) => {
  const [previewMessage, setPreviewMessage] = useState(false);
  const [state, action] = useActionState(createWorkspace, null);
  const router = useRouter();
  const titleError =
    state !== null && !state.ok ? state.fieldErrors?.title?.[0] : undefined;
  useEffect(() => {
    if (state?.ok) {
      onOpenChange(false);
      router.push(`/workspace/${state.data.slug}`);
    }
  }, [onOpenChange, router, state]);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (preview) {
          event.preventDefault();
          setPreviewMessage(true);
        }
      }}
    >
      {previewMessage ? (
        <p role="status" className="text-sm text-muted-foreground">
          Design preview only. No workspace was created.
        </p>
      ) : null}
      <div className="grid gap-4 py-4">
        {state !== null && !state.ok && titleError === undefined ? (
          <p className="text-sm text-destructive" role="alert">
            {state.message}
          </p>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="title">Workspace name</Label>
          <Input
            aria-describedby={
              titleError === undefined ? undefined : "title-error"
            }
            aria-invalid={titleError === undefined ? undefined : true}
            autoComplete="off"
            className="h-10 md:h-9"
            id="title"
            maxLength={80}
            name="title"
            placeholder="Research lab"
            required
          />
          {titleError === undefined ? null : (
            <p className="text-xs text-destructive" id="title-error">
              {titleError}
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            maxLength={500}
            name="description"
            placeholder="What this workspace is for"
            rows={3}
          />
        </div>
      </div>
      <DialogFooter>
        <SubmitButton onOpenChange={onOpenChange} />
      </DialogFooter>
    </form>
  );
};
