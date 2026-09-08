"use client";

import dynamic from "next/dynamic";
import { type FC, useCallback, useDeferredValue, useState } from "react";
import { Code, Edit3, Eye, FileText } from "lucide-react";
import {
  ViewPanel,
  ViewSwitcher,
  useViewSwitcherId,
  type ViewOption,
} from "@/components/shell/view-switcher";
import type { CollabTarget } from "@/modules/docs/collab-target";
import { DocEditor } from "@/modules/docs/doc-editor";
import { DocHeader } from "@/modules/docs/doc-header";
import { DocumentPresence } from "@/modules/docs/document-presence";
import {
  permissionFromRole,
  type DocumentPermission,
} from "@/modules/docs/document-editability";
import type { DocumentSessionState } from "@/modules/docs/use-document-session";
import type { WorkspaceRole } from "@/lib/workspace-roles";
import {
  canDeleteDocument,
  canEditDocument,
  canShareDocument,
} from "@/lib/permissions";

const PreviewPane = dynamic(() =>
  import("@/modules/docs/preview-pane").then((module) => module.PreviewPane),
);
const LatexPane = dynamic(() =>
  import("@/modules/docs/latex-pane").then((module) => module.LatexPane),
);

type AuthenticatedDocumentEditorProps = {
  readonly authorId: string;
  readonly avatarUrl: string | null;
  readonly collabTarget: CollabTarget;
  readonly currentUserId: string;
  readonly docSlug: string;
  readonly documentId: string;
  readonly isPublic: boolean;
  readonly publicView?: false;
  readonly role: WorkspaceRole;
  readonly title: string;
  readonly userName: string;
  readonly workspaceSlug: string;
};

type PublicDocumentEditorProps = {
  readonly collabTarget: CollabTarget;
  readonly docSlug: string;
  readonly documentId: string;
  readonly publicView: true;
  readonly title: string;
};

export type DocumentEditorProps =
  | AuthenticatedDocumentEditorProps
  | PublicDocumentEditorProps;

export const DOCUMENT_VIEW = {
  Editor: "editor",
  Preview: "preview",
  Markdown: "markdown",
  Latex: "latex",
} as const;

export type DocumentView = (typeof DOCUMENT_VIEW)[keyof typeof DOCUMENT_VIEW];

const VIEW_OPTIONS: ReadonlyArray<ViewOption> = [
  {
    icon: <Edit3 className="size-3.5" />,
    label: "Editor",
    value: DOCUMENT_VIEW.Editor,
  },
  {
    icon: <Eye className="size-3.5" />,
    label: "Preview",
    value: DOCUMENT_VIEW.Preview,
  },
  {
    icon: <FileText className="size-3.5" />,
    label: "Markdown",
    value: DOCUMENT_VIEW.Markdown,
  },
  {
    icon: <Code className="size-3.5" />,
    label: "LaTeX",
    value: DOCUMENT_VIEW.Latex,
  },
];

const EditorLoading = () => (
  <div className="grid min-h-64 place-items-center font-mono text-xs text-muted-foreground">
    Preparing view…
  </div>
);

export const DocumentEditor: FC<DocumentEditorProps> = (props) => {
  const [title, setTitle] = useState(props.title);
  const [markdown, setMarkdown] = useState("");
  const [isPublic, setIsPublic] = useState(
    props.publicView === true ? true : props.isPublic,
  );
  const [session, setSession] = useState<DocumentSessionState | null>(null);
  const [view, setView] = useState<DocumentView>(DOCUMENT_VIEW.Editor);
  // Preview and LaTeX are heavy and lazily loaded; remember which ones have
  // ever been opened so returning to one does not show the loader again.
  const [openedViews, setOpenedViews] = useState<ReadonlySet<string>>(
    () => new Set<string>([DOCUMENT_VIEW.Editor]),
  );
  const viewId = useViewSwitcherId();
  const deferredMarkdown = useDeferredValue(markdown);
  const handleMarkdownChange = useCallback((nextMarkdown: string) => {
    setMarkdown(nextMarkdown);
  }, []);
  const handleCollaborationChange = useCallback(
    (state: DocumentSessionState) => setSession(state),
    [],
  );
  const handleViewChange = useCallback((next: string) => {
    setView(next as DocumentView);
    setOpenedViews((current) =>
      current.has(next) ? current : new Set([...current, next]),
    );
  }, []);

  if (props.publicView === true) {
    return (
      <main className="min-h-dvh bg-background text-foreground">
        <header className="border-b px-5 py-5 sm:px-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-emphasis">
            Shared read-only document
          </p>
          <h1 className="mt-2 font-display text-2xl font-semibold sm:text-3xl">
            {props.title}
          </h1>
        </header>
        <div className="mx-auto min-h-[calc(100dvh-7rem)] max-w-5xl overflow-hidden">
          <DocEditor
            collabTarget={props.collabTarget}
            documentId={props.documentId}
            isShared
            onCollaborationChange={handleCollaborationChange}
            permission={null}
            sessionMode="public"
          />
        </div>
        <span className="sr-only" aria-live="polite">
          {session?.status ?? "connecting"}
        </span>
      </main>
    );
  }

  const canEdit = canEditDocument(props.role);
  const canDelete = canDeleteDocument(
    props.role,
    props.authorId,
    props.currentUserId,
  );
  const permission: DocumentPermission | null = permissionFromRole(props.role);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-document">
      <DocHeader
        canDelete={canDelete}
        canEdit={canEdit}
        canShare={canShareDocument(props.role)}
        collaborationStatus={session?.collaborationStatus ?? "connecting"}
        docSlug={props.docSlug}
        documentId={props.documentId}
        flushDocument={session?.flush}
        isPublic={isPublic}
        markdown={deferredMarkdown}
        onSharingChange={setIsPublic}
        role={props.role}
        saveStatus={session?.saveStatus ?? "idle"}
        setTitle={setTitle}
        title={title}
        workspaceSlug={props.workspaceSlug}
      />
      <div className="border-b border-divider px-2 sm:px-3">
        <ViewSwitcher
          baseId={viewId}
          label="Document views"
          onValueChange={handleViewChange}
          options={VIEW_OPTIONS}
          value={view}
        />
      </div>
      {/*
        Every panel is mounted for the life of the document. The editor panel
        in particular owns the Lexical instance, the collaborative replica and
        the presence connection; unmounting it to look at the Markdown would
        drop unacknowledged edits and reset undo history.
      */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ViewPanel
          active={view === DOCUMENT_VIEW.Editor}
          baseId={viewId}
          className="flex min-h-0 flex-1 flex-col overflow-auto"
          value={DOCUMENT_VIEW.Editor}
        >
          <DocumentPresence
            avatarUrl={props.avatarUrl}
            collabTarget={props.collabTarget}
            documentId={props.documentId}
            isShared={isPublic}
            name={props.userName}
            onCollaborationChange={handleCollaborationChange}
            onMarkdownChange={handleMarkdownChange}
            permission={permission}
            presenceEnabled={isPublic}
            userId={props.currentUserId}
          />
        </ViewPanel>
        <ViewPanel
          active={view === DOCUMENT_VIEW.Preview}
          baseId={viewId}
          className="min-h-0 flex-1 overflow-auto"
          value={DOCUMENT_VIEW.Preview}
        >
          {openedViews.has(DOCUMENT_VIEW.Preview) ? (
            <PreviewPane markdown={deferredMarkdown} />
          ) : (
            <EditorLoading />
          )}
        </ViewPanel>
        <ViewPanel
          active={view === DOCUMENT_VIEW.Markdown}
          baseId={viewId}
          className="min-h-0 flex-1 overflow-auto"
          value={DOCUMENT_VIEW.Markdown}
        >
          <pre className="prose-measure min-h-full whitespace-pre-wrap break-words px-5 py-8 font-mono text-xs leading-6 sm:px-8">
            {deferredMarkdown}
          </pre>
        </ViewPanel>
        <ViewPanel
          active={view === DOCUMENT_VIEW.Latex}
          baseId={viewId}
          className="min-h-0 flex-1 overflow-auto"
          value={DOCUMENT_VIEW.Latex}
        >
          {openedViews.has(DOCUMENT_VIEW.Latex) ? (
            <LatexPane markdown={deferredMarkdown} title={title} />
          ) : (
            <EditorLoading />
          )}
        </ViewPanel>
      </div>
    </div>
  );
};
