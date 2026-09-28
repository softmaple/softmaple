"use client";

import type { FC, Dispatch, SetStateAction } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@softmaple/ui/components/dialog";

import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@softmaple/ui/components/sheet";
import { useMobileWorkspace } from "./use-mobile-workspace";
import { paperSerif, paperSurface } from "./workspace-paper";
import { CreateWorkspaceForm } from "@/modules/workspaces/create-workspace-form";

type CreateWorkspaceDialogProps = {
  open: boolean;
  preview?: boolean;
  onOpenChange: Dispatch<SetStateAction<boolean>>;
};

const titleClass = `${paperSerif} text-2xl font-normal tracking-tight`;

export const CreateWorkspaceDialog: FC<CreateWorkspaceDialogProps> = (
  props,
) => {
  const { open, onOpenChange, preview = false } = props;
  const mobile = useMobileWorkspace();
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          showCloseButton
          className={`${paperSurface} px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]`}
        >
          <SheetTitle className={titleClass}>Create workspace</SheetTitle>
          <SheetDescription>
            A space for your documents and the people you write with.
          </SheetDescription>
          <CreateWorkspaceForm onOpenChange={onOpenChange} preview={preview} />
        </SheetContent>
      </Sheet>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${paperSurface} sm:max-w-[440px]`}>
        <DialogHeader>
          <DialogTitle className={titleClass}>Create workspace</DialogTitle>
          <DialogDescription>
            A space for your documents and the people you write with.
          </DialogDescription>
        </DialogHeader>

        <CreateWorkspaceForm onOpenChange={onOpenChange} preview={preview} />
      </DialogContent>
    </Dialog>
  );
};
