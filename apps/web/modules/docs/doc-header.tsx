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
  Radio,
  Share2,
  Trash2,
  Users,
  WifiOff,
} from "lucide-react";
import {
  deleteDocument,
  setDocumentPublic,
  updateDocumentTitle,
} from "@/app/actions/documents/documents";
import type { WorkspaceRole } from "@/lib/workspace-roles";
import type { DocumentUiStatus } from "@/modules/docs/use-document-session";
import type {
  SaveStatus,
  CollaborationStatus,
} from "@/modules/docs/use-document-session";

export type DocHeaderProps = {
  saveStatus?: SaveStatus;
  collaborationStatus?: CollaborationStatus;
  canDelete: boolean;
  canEdit: boolean;
  canShare: boolean;
  docSlug: string;
  documentId: string;
  flushDocument?: () => Promise<void>;
  isPublic: boolean;
  markdown: string;
  onSharingChange: (isPublic: boolean) => void;
  role: WorkspaceRole;
  setTitle: Dispatch<SetStateAction<string>>;
  status: DocumentUiStatus;
  title: string;
  workspaceSlug: string;
};

const STATUS_COPY: Readonly<
  Record<DocumentUiStatus, { readonly label: string; readonly tone: string }>
> = {
  connecting: { label: "Connecting", tone: "text-muted-foreground" },
  syncing: { label: "Syncing", tone: "text-warning" },
  saving: { label: "Saving", tone: "text-warning" },
  saved: { label: "Saved", tone: "text-success" },
  offline: { label: "Offline", tone: "text-warning" },
  error: { label: "Error", tone: "text-destructive" },
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
  status,
  saveStatus,
  collaborationStatus,
  title,
  workspaceSlug,
}) => {
  const router = useRouter();
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const lastCommittedTitle = useRef(title);
  const statusCopy =
    saveStatus === undefined
      ? STATUS_COPY[status]
      : {
          label:
            saveStatus === "error"
              ? "Save failed"
              : saveStatus === "saving"
                ? "Saving…"
                : saveStatus === "saved"
                  ? "Saved"
                  : "Loading…",
          tone:
            saveStatus === "error"
              ? "text-destructive"
              : "text-muted-foreground",
        };

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
          ? "Public read-only link enabled. Workspace members can now collaborate live."
          : "Public link disabled.",
      );
    });
  };

  const copyShareLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/share/${docSlug}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      setMessage("Copy is unavailable. Select and copy the public link below.");
      setSharingOpen(true);
    }
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
        <div
          aria-live="polite"
          className={`flex shrink-0 items-center gap-1.5 font-mono text-[11px] ${statusCopy.tone}`}
          role="status"
        >
          {status === "offline" ? (
            <WifiOff className="size-3.5" />
          ) : status === "saved" ? (
            <Check className="size-3.5" />
          ) : (
            <Radio className="size-3.5" />
          )}
          {statusCopy.label}
        </div>
        {collaborationStatus === "reconnecting" ||
        collaborationStatus === "offline" ||
        collaborationStatus === "error" ? (
          <span className="text-xs text-warning" role="status">
            Live sync interrupted
          </span>
        ) : null}
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
          <Button
            aria-label="Download LaTeX"
            onClick={exportLatex}
            size="sm"
            variant="ghost"
          >
            <FileCode2 className="size-4" />
            <span className="hidden sm:inline">LaTeX</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={sharingOpen}
            aria-label="Access"
            onClick={() => setSharingOpen(!sharingOpen)}
          >
            <Users className="size-4 sm:hidden" />
            <span className="hidden sm:inline">Access</span>
          </Button>
          {canShare ? (
            <>
              <Button
                aria-label={isPublic ? "Disable link" : "Share"}
                title={isPublic ? "Disable public link" : "Enable public link"}
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
                <span className="hidden sm:inline">
                  {isPublic ? "Disable link" : "Share"}
                </span>
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
      {sharingOpen ? (
        <section
          className="mt-3 rounded-xl border bg-surface p-4 text-sm"
          aria-label="Document access"
        >
          <h2 className="font-medium">Workspace access</h2>
          <p className="mt-1 text-muted-foreground">
            Owners and editors can edit. Viewers can read and export.
          </p>
          <a
            className="mt-2 inline-flex text-link underline"
            href={`/workspace/${workspaceSlug}/settings?tab=members`}
          >
            View workspace members
          </a>
          <h2 className="mt-4 font-medium">
            Public read-only link · {isPublic ? "enabled" : "disabled"}
          </h2>
          <p className="mt-1 text-muted-foreground">
            Anyone with the link can read this document. Enabling it also starts
            live collaboration for workspace members.
          </p>
          {isPublic ? (
            <Input
              className="mt-3"
              aria-label="Public read-only URL"
              readOnly
              value={
                typeof window === "undefined"
                  ? `/share/${docSlug}`
                  : `${window.location.origin}/share/${docSlug}`
              }
              onFocus={(event) => event.target.select()}
            />
          ) : null}
        </section>
      ) : null}
      {message === null ? null : (
        <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      )}
      {saveStatus === "error" ? (
        <div
          className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-destructive p-3 text-sm"
          role="alert"
        >
          <span>Your latest changes could not be saved.</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void flushDocument?.().catch(() =>
                setMessage(
                  "Saving is still unavailable. Download Markdown to keep a copy.",
                ),
              );
            }}
          >
            Retry save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              downloadText(
                markdown,
                `${docSlug}.md`,
                "text/markdown;charset=utf-8",
              )
            }
          >
            Download a copy
          </Button>
        </div>
      ) : null}
    </header>
  );
};
