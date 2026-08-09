"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { Textarea } from "@softmaple/ui/components/textarea";
import { DialogFooter } from "@softmaple/ui/components/dialog";
import { createWorkspace } from "@/app/actions/workspaces";
import type { SubmitButtonProps } from "@/modules/workspaces/submit-button";
import { SubmitButton } from "@/modules/workspaces/submit-button";

export const CreateWorkspaceForm = ({ onOpenChange }: SubmitButtonProps) => {
  const [state, action] = useActionState(createWorkspace, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) {
      onOpenChange(false);
      router.push(`/workspace/${state.data.slug}`);
    }
  }, [onOpenChange, router, state]);

  return (
    <form action={action}>
      <div className="grid gap-4 py-4">
        {state !== null && !state.ok ? (
          <p className="text-sm text-destructive" role="alert">
            {state.message}
          </p>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="title">Workspace name</Label>
          <Input id="title" name="title" placeholder="Research lab" required />
          <p className="text-xs text-destructive">
            {state !== null && !state.ok ? state.fieldErrors?.title?.[0] : null}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
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
