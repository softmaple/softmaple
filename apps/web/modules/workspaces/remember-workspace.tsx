"use client";

import { useEffect } from "react";
import { useDefaultWorkspace } from "./use-default-workspace";

/** Mounted only after the server has verified access to this workspace. */
export function RememberWorkspace({
  userId,
  workspaceId,
}: {
  userId: string;
  workspaceId: number;
}) {
  const { setDefaultWorkspace } = useDefaultWorkspace(userId);
  useEffect(() => {
    setDefaultWorkspace(workspaceId);
  }, [setDefaultWorkspace, workspaceId]);
  return null;
}
