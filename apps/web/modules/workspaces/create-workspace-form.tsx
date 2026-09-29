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
  // Controlled, so a rejected submission keeps what was typed (React resets
  // uncontrolled fields after every form action).
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [state, action, pending] = useActionState(createWorkspace, null);
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
      aria-busy={pending}
      onSubmit={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
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
            className="h-11 md:h-9"
            enterKeyHint="next"
            readOnly={pending}
            id="title"
            maxLength={80}
            name="title"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Research lab"
            required
            value={title}
          />
          {titleError === undefined ? null : (
            <p
              className="text-xs text-destructive"
              id="title-error"
              role="alert"
            >
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
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this workspace is for"
            rows={3}
            readOnly={pending}
            value={description}
          />
        </div>
      </div>
      <DialogFooter>
        <SubmitButton onOpenChange={onOpenChange} />
      </DialogFooter>
    </form>
  );
};
