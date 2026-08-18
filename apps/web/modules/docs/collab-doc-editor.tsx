"use client";

import { type FC, useEffect } from "react";
import { LexicalEgWalkerPlugin } from "@softmaple/binding-lexical/react";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
import { LEXICAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import { lexicalStateToMarkdown } from "@softmaple/editor/markdown";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import type { EditorProps } from "@softmaple/editor/components/core/Editor";
import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
import type { CollabTarget } from "@/modules/docs/collab-target";
import type { DocumentPermission } from "@/modules/docs/document-editability";
import {
  useDocumentSession,
  type CollabSessionMode,
  type DocumentSessionState,
} from "@/modules/docs/use-document-session";

export type CollabDocEditorProps = Pick<
  EditorProps,
  "activeEditor" | "setActiveEditor"
> & {
  documentId: string;
  collabTarget: CollabTarget;
  commonEditorConfig?: InitialConfigType;
  isShared?: boolean;
  onCollaborationChange?: (state: DocumentSessionState) => void;
  onExternalBindingChange?: (binding: LexicalBinding | null) => void;
  onMarkdownChange?: (markdown: string) => void;
  onSelectionChange?: (selection: StableBlockSelection | null) => void;
  permission?: DocumentPermission | null;
  sessionMode?: CollabSessionMode;
};

const MarkdownSyncPlugin: FC<{
  onMarkdownChange: (markdown: string) => void;
}> = ({ onMarkdownChange }) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    onMarkdownChange(lexicalStateToMarkdown(editor.getEditorState()));
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = setTimeout(
        () => onMarkdownChange(lexicalStateToMarkdown(editorState)),
        80,
      );
    });
    return () => {
      if (timeout !== null) clearTimeout(timeout);
      unregister();
    };
  }, [editor, onMarkdownChange]);

  return null;
};

const CollabBindingPlugin: FC<{
  editable: boolean;
  onBindingChange: DocumentSessionState["onBindingChange"];
  onExternalBindingChange?: (binding: LexicalBinding | null) => void;
  onSelectionChange?: (selection: StableBlockSelection | null) => void;
  replica: NonNullable<DocumentSessionState["replica"]>;
}> = ({
  editable,
  onBindingChange,
  onExternalBindingChange,
  onSelectionChange,
  replica,
}) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(editable);
  }, [editable, editor]);

  return (
    <LexicalEgWalkerPlugin
      replica={replica}
      enableEditingOnReady={false}
      onBindingChange={(binding) => {
        onBindingChange(binding);
        onExternalBindingChange?.(binding);
      }}
      onError={(error) => console.error("Collaboration binding failed", error)}
      onSelectionChange={onSelectionChange}
    />
  );
};

export const CollabDocEditor: FC<CollabDocEditorProps> = ({
  documentId,
  collabTarget,
  commonEditorConfig,
  activeEditor,
  isShared = true,
  onCollaborationChange,
  onExternalBindingChange,
  onMarkdownChange,
  onSelectionChange,
  permission = null,
  sessionMode = "authenticated",
  setActiveEditor,
}) => {
  const session = useDocumentSession({
    documentId,
    collabTarget,
    isShared,
    permission,
    sessionMode,
  });

  useEffect(() => {
    onCollaborationChange?.(session);
  }, [onCollaborationChange, session]);

  const lexicalConfig: InitialConfigType = {
    ...LEXICAL_PLAYGROUND_CONFIG,
    ...commonEditorConfig,
    editable: session.editable,
  };

  if (session.replica === null) {
    return (
      <div className="grid h-full min-h-64 place-items-center text-sm text-muted-foreground">
        {session.error?.message ?? "Loading document…"}
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <CoreEditor
        activeEditor={activeEditor}
        setActiveEditor={setActiveEditor}
        historyMode="disabled"
        lexicalConfig={lexicalConfig}
        showToolbar={session.editable}
      >
        <CollabBindingPlugin
          editable={session.editable}
          onBindingChange={session.onBindingChange}
          onExternalBindingChange={onExternalBindingChange}
          onSelectionChange={onSelectionChange}
          replica={session.replica}
        />
        {onMarkdownChange === undefined ? null : (
          <MarkdownSyncPlugin onMarkdownChange={onMarkdownChange} />
        )}
      </CoreEditor>
    </div>
  );
};
