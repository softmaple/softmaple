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
import {
  useCollabDocument,
  type CollabDocumentState,
  type CollabSessionMode,
} from "@/modules/docs/use-collab-document";

export type CollabDocEditorProps = Pick<
  EditorProps,
  "activeEditor" | "setActiveEditor"
> & {
  documentId: string;
  commonEditorConfig?: InitialConfigType;
  onCollaborationChange?: (state: CollabDocumentState) => void;
  onExternalBindingChange?: (binding: LexicalBinding | null) => void;
  onMarkdownChange?: (markdown: string) => void;
  onSelectionChange?: (selection: StableBlockSelection | null) => void;
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
  canWrite: CollabDocumentState["canWrite"];
  onBindingChange: CollabDocumentState["onBindingChange"];
  onExternalBindingChange?: (binding: LexicalBinding | null) => void;
  onSelectionChange?: (selection: StableBlockSelection | null) => void;
  replica: NonNullable<CollabDocumentState["replica"]>;
}> = ({
  canWrite,
  onBindingChange,
  onExternalBindingChange,
  onSelectionChange,
  replica,
}) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(canWrite);
  }, [canWrite, editor]);

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
  commonEditorConfig,
  activeEditor,
  onCollaborationChange,
  onExternalBindingChange,
  onMarkdownChange,
  onSelectionChange,
  sessionMode = "authenticated",
  setActiveEditor,
}) => {
  const collaboration = useCollabDocument(documentId, sessionMode);

  useEffect(() => {
    onCollaborationChange?.(collaboration);
  }, [collaboration, onCollaborationChange]);

  const lexicalConfig: InitialConfigType = {
    ...LEXICAL_PLAYGROUND_CONFIG,
    ...commonEditorConfig,
    editable: false,
  };

  if (collaboration.replica === null) {
    return (
      <div className="grid h-full min-h-64 place-items-center text-sm text-muted-foreground">
        {collaboration.error?.message ?? "Loading document history…"}
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
        showToolbar={sessionMode === "authenticated" && collaboration.canWrite}
      >
        <CollabBindingPlugin
          canWrite={collaboration.canWrite}
          onBindingChange={collaboration.onBindingChange}
          onExternalBindingChange={onExternalBindingChange}
          onSelectionChange={onSelectionChange}
          replica={collaboration.replica}
        />
        {onMarkdownChange === undefined ? null : (
          <MarkdownSyncPlugin onMarkdownChange={onMarkdownChange} />
        )}
      </CoreEditor>
    </div>
  );
};
