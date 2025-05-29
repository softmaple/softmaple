"use client";

import type React from "react";

import { useState } from "react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import { Textarea } from "@softmaple/ui/components/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@softmaple/ui/components/dialog";

interface CreateWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateWorkspace: (workspace: { name: string; description: string }) => void;
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreateWorkspace,
}: CreateWorkspaceDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsLoading(true);

    // Simulate creation delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    onCreateWorkspace({ name: name.trim(), description: description.trim() });

    // Reset form
    setName("");
    setDescription("");
    setIsLoading(false);
  };

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
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Workspace Name</Label>
              <Input
                id="name"
                placeholder="My Research Project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="A brief description of your workspace..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading || !name.trim()}>
              {isLoading ? "Creating..." : "Create Workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
