"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ModeToggle } from "@/components/mode-toggle";
import { SoftmapleWordmark } from "@/components/BrandMark";
import { type FC, useCallback, useDeferredValue, useState } from "react";
import { Code, Edit3, Eye, FileText } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@softmaple/ui/components/tabs";
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

const EditorLoading = () => (
  <div className="grid min-h-64 place-items-center font-mono text-xs text-muted-foreground">
    Preparing view…
  </div>
);

export const DocumentEditor: FC<DocumentEditorProps> = (props) => {
  const [title, setTitle] = useState(props.title);
  const [activeView, setActiveView] = useState("editor");
  const [markdown, setMarkdown] = useState("");
  const [isPublic, setIsPublic] = useState(
    props.publicView === true ? true : props.isPublic,
  );
  const [session, setSession] = useState<DocumentSessionState | null>(null);
  const [openedViews, setOpenedViews] = useState<ReadonlySet<string>>(
    () => new Set(["editor"]),
  );
  const deferredMarkdown = useDeferredValue(markdown);
  const handleMarkdownChange = useCallback((nextMarkdown: string) => {
    setMarkdown(nextMarkdown);
  }, []);
  const handleCollaborationChange = useCallback(
    (state: DocumentSessionState) => setSession(state),
    [],
  );

  if (props.publicView === true) {
    return (
      <main className="min-h-dvh bg-background text-foreground">
        <header className="border-b px-5 py-5 sm:px-8">
          <div className="mb-7 flex items-center justify-between">
            <Link href="/">
              <SoftmapleWordmark className="text-xl" />
            </Link>
            <ModeToggle />
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-emphasis">
            Shared read-only document
          </p>
          <h1 className="mt-2 font-display text-2xl font-semibold sm:text-3xl">
            {props.title}
          </h1>
        </header>
        <div className="document-surface mx-auto min-h-[calc(100dvh-7rem)] max-w-5xl overflow-hidden">
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
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <DocHeader
        canDelete={canDelete}
        canEdit={canEdit}
        canShare={canShareDocument(props.role)}
        docSlug={props.docSlug}
        documentId={props.documentId}
        flushDocument={session?.flush}
        isPublic={isPublic}
        markdown={deferredMarkdown}
        onSharingChange={setIsPublic}
        role={props.role}
        setTitle={setTitle}
        status={session?.status ?? "connecting"}
        saveStatus={session?.saveStatus}
        collaborationStatus={session?.collaborationStatus}
        title={title}
        workspaceSlug={props.workspaceSlug}
      />
      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        value={activeView}
        onValueChange={(value) => {
          setActiveView(value);
          setOpenedViews((current) => new Set([...current, value]));
        }}
      >
        <div className="border-b px-3 sm:px-5">
          <TabsList className="h-11 max-w-full justify-start overflow-x-auto rounded-none bg-transparent p-0 sm:h-10">
            <TabsTrigger value="editor">
              <Edit3 className="hidden size-3.5 sm:block" /> Editor
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye className="hidden size-3.5 sm:block" /> Preview
            </TabsTrigger>
            <TabsTrigger value="markdown">
              <FileText className="hidden size-3.5 sm:block" /> Markdown
            </TabsTrigger>
            <TabsTrigger value="latex">
              <Code className="hidden size-3.5 sm:block" /> LaTeX
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent
          className="document-surface m-0 min-h-0 flex-1 overflow-auto data-[state=inactive]:hidden"
          value="editor"
          forceMount
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
            surfaceActive={activeView === "editor"}
            userId={props.currentUserId}
          />
        </TabsContent>
        <TabsContent
          className="m-0 min-h-0 flex-1 overflow-auto"
          value="preview"
        >
          {openedViews.has("preview") ? (
            <PreviewPane markdown={deferredMarkdown} />
          ) : (
            <EditorLoading />
          )}
        </TabsContent>
        <TabsContent
          className="m-0 min-h-0 flex-1 overflow-auto"
          value="markdown"
        >
          <pre className="mx-auto min-h-full max-w-4xl whitespace-pre-wrap break-words px-5 py-8 font-mono text-xs leading-6 sm:px-8">
            {deferredMarkdown}
          </pre>
        </TabsContent>
        <TabsContent className="m-0 min-h-0 flex-1 overflow-auto" value="latex">
          {openedViews.has("latex") ? (
            <LatexPane markdown={deferredMarkdown} title={title} />
          ) : (
            <EditorLoading />
          )}
        </TabsContent>
      </Tabs>
    </main>
  );
};
