"use client";

import {
  type Dispatch,
  type FC,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Badge } from "@softmaple/ui/components/badge";
import {
  Check,
  Clipboard,
  Download,
  FileCode2,
  LoaderCircle,
  Share2,
  Trash2,
} from "lucide-react";
import {
  deleteDocument,
  setDocumentPublic,
  updateDocumentTitle,
} from "@/app/actions/documents/documents";
import { StatusIndicator } from "@/components/shell/status-indicator";
import type { WorkspaceRole } from "@/lib/workspace-roles";
import type {
  CollaborationStatus,
  SaveStatus,
} from "@/modules/docs/document-save-coordinator";
import {
  describeCollaborationStatus,
  describeSaveStatus,
  summariseDocumentStatus,
} from "@/modules/docs/document-status";

export type DocHeaderProps = {
  canDelete: boolean;
  canEdit: boolean;
  canShare: boolean;
  /** Whether other people are reachable. Says nothing about durability. */
  collaborationStatus: CollaborationStatus;
  docSlug: string;
  documentId: string;
  flushDocument?: () => Promise<void>;
  isPublic: boolean;
  markdown: string;
  onSharingChange: (isPublic: boolean) => void;
  role: WorkspaceRole;
  /** How durable the work is. Never affected by the presence transport. */
  saveStatus: SaveStatus;
  setTitle: Dispatch<SetStateAction<string>>;
  title: string;
  workspaceSlug: string;
};

const downloadText = (content: string, name: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const DocHeader: FC<DocHeaderProps> = ({
  canDelete,
  canEdit,
  canShare,
  docSlug,
  documentId,
  flushDocument,
  isPublic: initialIsPublic,
  markdown,
  onSharingChange,
  role,
  setTitle,
  collaborationStatus,
  saveStatus,
  title,
  workspaceSlug,
}) => {
  const router = useRouter();
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPending, startTransition] = useTransition();
  const lastCommittedTitle = useRef(title);

  useEffect(() => {
    setIsPublic(initialIsPublic);
  }, [initialIsPublic]);

  const persistTitle = useCallback(() => {
    const normalizedTitle = title.trim();
    if (!canEdit || normalizedTitle.length === 0) return;
    if (normalizedTitle === lastCommittedTitle.current) return;
    startTransition(async () => {
      const result = await updateDocumentTitle({
        docSlug,
        title: normalizedTitle,
        workspaceSlug,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      lastCommittedTitle.current = result.data.title;
      setTitle(result.data.title);
      setMessage(null);
    });
  }, [canEdit, docSlug, setTitle, title, workspaceSlug]);

  useEffect(() => {
    const timeout = setTimeout(persistTitle, 700);
    return () => clearTimeout(timeout);
  }, [persistTitle]);

  const toggleSharing = (): void => {
    startTransition(async () => {
      const enabling = !isPublic;
      if (enabling) {
        if (flushDocument === undefined) {
          setMessage("The document is still loading. Try again in a moment.");
          return;
        }
        try {
          await flushDocument();
        } catch {
          setMessage("Could not save the latest edits before sharing.");
          return;
        }
      }

      const result = await setDocumentPublic({
        docSlug,
        documentId,
        enabled: enabling,
        workspaceSlug,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setIsPublic(result.data.enabled);
      onSharingChange(result.data.enabled);
      setMessage(
        result.data.enabled
          ? "Public collaboration link enabled."
          : "Public link disabled.",
      );
    });
  };

  const copyShareLink = async (): Promise<void> => {
    await navigator.clipboard.writeText(
      `${window.location.origin}/share/${docSlug}`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  };

  const removeDocument = (): void => {
    if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return;
    startTransition(async () => {
      const result = await deleteDocument({
        docSlug,
        documentId,
        workspaceSlug,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      router.replace(`/workspace/${workspaceSlug}`);
      router.refresh();
    });
  };

  const exportLatex = (): void => {
    startTransition(async () => {
      const { markdownToLatex } = await import("@softmaple/md2latex");
      downloadText(
        markdownToLatex(markdown, { title }),
        `${docSlug}.tex`,
        "text/x-latex;charset=utf-8",
      );
    });
  };

  return (
    <header className="border-b bg-background/95 px-3 py-2 backdrop-blur sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Input
          aria-label="Document title"
          className="h-9 min-w-36 flex-1 border-0 bg-transparent px-1 font-display text-lg font-semibold shadow-none focus-visible:ring-1"
          disabled={!canEdit || isPending}
          maxLength={160}
          onBlur={persistTitle}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          value={title}
        />
        <Badge className="shrink-0 font-mono text-[10px]" variant="outline">
          {role.toLowerCase()}
        </Badge>
        {/*
          Two indicators, never one. A person whose connection has dropped
          needs to know their last paragraph is safe; a single collapsed label
          cannot tell them that, and "Offline" alone implies it is not.
        */}
        <div className="flex shrink-0 items-center gap-1" role="status">
          <StatusIndicator {...describeSaveStatus(saveStatus)} />
          <StatusIndicator
            {...describeCollaborationStatus(collaborationStatus)}
          />
          <span className="sr-only">
            {summariseDocumentStatus({ collaborationStatus, saveStatus })}
          </span>
        </div>
        <div className="ml-auto flex max-w-full items-center gap-1 overflow-x-auto pb-0.5">
          <Button
            aria-label="Download Markdown"
            onClick={() =>
              downloadText(
                markdown,
                `${docSlug}.md`,
                "text/markdown;charset=utf-8",
              )
            }
            size="sm"
            variant="ghost"
          >
            <Download className="size-4" />
            <span className="hidden sm:inline">Markdown</span>
          </Button>
          <Button onClick={exportLatex} size="sm" variant="ghost">
            <FileCode2 className="size-4" />
            <span className="hidden sm:inline">LaTeX</span>
          </Button>
          {canShare ? (
            <>
              <Button
                disabled={
                  isPending || (!isPublic && flushDocument === undefined)
                }
                onClick={toggleSharing}
                size="sm"
                variant="outline"
              >
                {isPending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Share2 className="size-4" />
                )}
                {isPublic ? "Disable link" : "Share"}
              </Button>
              {isPublic ? (
                <Button
                  aria-label="Copy public link"
                  onClick={() => void copyShareLink()}
                  size="icon-sm"
                  variant="ghost"
                >
                  {copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Clipboard className="size-4" />
                  )}
                </Button>
              ) : null}
            </>
          ) : null}
          {canDelete ? (
            <Button
              aria-label="Delete document"
              onClick={removeDocument}
              size="icon-sm"
              variant="ghost"
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          ) : null}
        </div>
      </div>
      {message === null ? null : (
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      )}
    </header>
  );
};
