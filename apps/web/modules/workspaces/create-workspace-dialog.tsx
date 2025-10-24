"use client";

import type { FC, Dispatch, SetStateAction } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@softmaple/ui/components/dialog";

import { CreateWorkspaceForm } from "@/modules/workspaces/create-workspace-form";

type CreateWorkspaceDialogProps = {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
};

export const CreateWorkspaceDialog: FC<CreateWorkspaceDialogProps> = (
  props,
) => {
  const { open, onOpenChange } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Workspace</DialogTitle>
          <DialogDescription>
            Create a new workspace to organize your documents and collaborate
            with your team.
          </DialogDescription>
        </DialogHeader>

        <CreateWorkspaceForm onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
};
