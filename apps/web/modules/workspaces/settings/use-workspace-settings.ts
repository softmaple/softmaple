"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteWorkspace, updateWorkspace } from "@/app/actions/workspaces";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@/lib/workspace-roles";
import type { WorkspacesType } from "@/types/model";

export function useWorkspaceSettings({
  workspace,
  role,
  preview,
}: {
  workspace: WorkspacesType["Row"];
  role: WorkspaceRole;
  preview: boolean;
}) {
  const router = useRouter();
  const isOwner = role === WORKSPACE_ROLE.Owner;
  const [saved, setSaved] = useState({
    title: workspace.title,
    description: workspace.description ?? "",
  });
  const [title, setTitle] = useState(saved.title);
  const [description, setDescription] = useState(saved.description);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const submitting = useRef(false);
  const dirty = title !== saved.title || description !== saved.description;
  const valid =
    title.trim().length > 0 && title.length <= 80 && description.length <= 500;
  const workspaceHref = `/workspace/${workspace.slug}`;
  const reset = () => {
    setTitle(saved.title);
    setDescription(saved.description);
    setFeedback(null);
  };

  // Guard all in-app links (including account/brand), reloads, and tab closes.
  useEffect(() => {
    if (!dirty && !isPending) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const leave = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest("a[href]")) return;
      if (
        isPending ||
        !window.confirm("Discard your unsaved workspace changes?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // The Navigation API can cancel same-document browser Back/Forward before
    // Next.js processes it. The link and beforeunload guards cover other exits.
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation;
    const traverse = (event: Event) => {
      if (
        !("navigationType" in event) ||
        event.navigationType !== "traverse" ||
        !event.cancelable
      )
        return;
      if (
        isPending ||
        !window.confirm("Discard your unsaved workspace changes?")
      )
        event.preventDefault();
    };
    navigation?.addEventListener("navigate", traverse);
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", leave, true);
    return () => {
      navigation?.removeEventListener("navigate", traverse);
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", leave, true);
    };
  }, [dirty, isPending]);

  const save = () => {
    if (!isOwner || !dirty || !valid || submitting.current) return;
    if (preview) {
      setFeedback({
        error: true,
        text: "Design preview only. Changes are not saved.",
      });
      return;
    }
    submitting.current = true;
    setFeedback(null);
    startTransition(async () => {
      try {
        const result = await updateWorkspace({
          title,
          description,
          workspaceSlug: workspace.slug,
        });
        if (!result.ok) {
          setFeedback({ error: true, text: result.message });
          return;
        }
        const next = {
          title: result.data.title,
          description: result.data.description ?? "",
        };
        setSaved(next);
        setTitle(next.title);
        setDescription(next.description);
        setFeedback({ error: false, text: "Changes saved." });
        router.refresh();
      } catch {
        setFeedback({
          error: true,
          text: "Could not save changes. Please try again.",
        });
      } finally {
        submitting.current = false;
      }
    });
  };

  const remove = () => {
    if (preview || submitting.current) return;
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = await deleteWorkspace({
          confirmation,
          workspaceSlug: workspace.slug,
        });
        if (!result.ok) {
          setFeedback({ error: true, text: result.message });
          return;
        }
        setDeleteOpen(false);
        router.replace("/dashboard");
        router.refresh();
      } catch {
        setFeedback({
          error: true,
          text: "Could not delete the workspace. Please try again.",
        });
      } finally {
        submitting.current = false;
      }
    });
  };
  return {
    saved,
    title,
    setTitle,
    description,
    setDescription,
    deleteOpen,
    setDeleteOpen,
    confirmation,
    setConfirmation,
    feedback,
    setFeedback,
    isPending,
    dirty,
    valid,
    isOwner,
    workspaceHref,
    reset,
    save,
    remove,
  };
}

export type WorkspaceSettingsState = ReturnType<typeof useWorkspaceSettings>;
