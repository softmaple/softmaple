import type { FC } from "react";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { Textarea } from "@softmaple/ui/components/textarea";
import { DialogFooter } from "@softmaple/ui/components/dialog";
import { handleCreateWorkspaceFormData } from "@/app/actions/workspaces";
import type { SubmitButtonProps } from "@/modules/workspaces/submit-button";
import { SubmitButton } from "@/modules/workspaces/submit-button";

export type CreateWorkspaceFormProps = SubmitButtonProps;

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
