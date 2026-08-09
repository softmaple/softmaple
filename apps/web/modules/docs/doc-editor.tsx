"use client";

import { memo, type FC, useEffect, useState } from "react";
import { LEXICAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import { useEditorState } from "@/contexts/EditorStateContext";
import {
  CollabDocEditor,
  type CollabDocEditorProps,
} from "@/modules/docs/collab-doc-editor";

export type DocEditorProps = Pick<
  CollabDocEditorProps,
  | "documentId"
  | "onCollaborationChange"
  | "onExternalBindingChange"
  | "onMarkdownChange"
  | "onSelectionChange"
  | "sessionMode"
>;

const UnMemoizedDocEditor: FC<DocEditorProps> = ({
  documentId,
  onCollaborationChange,
  onExternalBindingChange,
  onMarkdownChange,
  onSelectionChange,
  sessionMode,
}) => {
  const [isMounted, setIsMounted] = useState(false);
  const { activeEditor, setActiveEditor } = useEditorState();

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  if (!isMounted) return null;

  const commonConfig: CollabDocEditorProps["commonEditorConfig"] = {
    ...LEXICAL_PLAYGROUND_CONFIG,
    namespace: "SoftmapleDocumentEditor",
    onError: (error: Error) => {
      console.error("Document editor failed", error);
    },
  };

  return (
    <CollabDocEditor
      documentId={documentId}
      activeEditor={activeEditor}
      setActiveEditor={setActiveEditor}
      commonEditorConfig={commonConfig}
      onCollaborationChange={onCollaborationChange}
      onExternalBindingChange={onExternalBindingChange}
      onMarkdownChange={onMarkdownChange}
      onSelectionChange={onSelectionChange}
      sessionMode={sessionMode}
    />
  );
};

export const DocEditor = memo(UnMemoizedDocEditor);
