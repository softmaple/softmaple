"use client";

import type { FC } from "react";
import { memo, useState, useEffect } from "react";

import { LEXICAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import { useEditorState } from "@/contexts/EditorStateContext";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
import { CollabDocEditor } from "@/modules/docs/collab-doc-editor";

export type DocEditorProps = {
  documentId?: string;
  enableCollab?: boolean;
};

const UnMemoizedDocEditor: FC<DocEditorProps> = (props) => {
  const { documentId, enableCollab = false } = props;
  const [isMounted, setIsMounted] = useState(false);
  const { activeEditor, setActiveEditor } = useEditorState();

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  if (!isMounted) return null;

  const commonConfig = {
    ...LEXICAL_PLAYGROUND_CONFIG,
    namespace: "DocEditor",
    onError: (error: unknown) => {
      console.error(error);
      throw error;
    },
  };

  if (enableCollab && documentId) {
    return (
      <CollabDocEditor
        documentId={documentId}
        activeEditor={activeEditor}
        setActiveEditor={setActiveEditor}
        commonEditorConfig={commonConfig}
      />
    );
  }

  return (
    <CoreEditor
      activeEditor={activeEditor}
      setActiveEditor={setActiveEditor}
      lexicalConfig={commonConfig}
    />
  );
};

export const DocEditor = memo(UnMemoizedDocEditor);
