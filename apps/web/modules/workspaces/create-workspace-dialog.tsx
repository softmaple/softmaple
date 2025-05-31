"use client";

import type { Dispatch, SetStateAction } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@softmaple/ui/components/dialog";

import { CreateWorkspaceForm } from "@/modules/workspaces/create-workspace-form";

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: CreateWorkspaceDialogProps) {
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
}
