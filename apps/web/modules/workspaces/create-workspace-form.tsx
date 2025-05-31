"use client";

import type { FC, Dispatch, SetStateAction } from "react";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { Textarea } from "@softmaple/ui/components/textarea";
import { DialogFooter } from "@softmaple/ui/components/dialog";
import { Button } from "@softmaple/ui/components/button";
import { useFormStatus } from "react-dom";
import { handleCreateWorkspaceFormData } from "@/app/actions/workspaces";

type SubmitButtonProps = {
  onOpenChange: Dispatch<SetStateAction<boolean>>;
};

const SubmitButton: FC<SubmitButtonProps> = (props) => {
  const { onOpenChange } = props;

  const { pending: isLoading } = useFormStatus();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => onOpenChange(false)}
        disabled={isLoading}
      >
        Cancel
      </Button>
      <Button type="submit" disabled={isLoading}>
        {isLoading ? "Creating..." : "Create Workspace"}
      </Button>
    </>
  );
};

type CreateWorkspaceFormProps = SubmitButtonProps;

export const CreateWorkspaceForm: FC<CreateWorkspaceFormProps> = (props) => {
  const { onOpenChange } = props;

  return (
    <form action={handleCreateWorkspaceFormData}>
      <div className="grid gap-4 py-4">
        <div className="space-y-2">
          <Label htmlFor="title">Workspace Name</Label>
          <Input
            id="title"
            name="title"
            placeholder="My Research Project"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="description">Description (optional)</Label>
          <Textarea
            id="description"
            name="description"
            placeholder="A brief description of your workspace..."
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
