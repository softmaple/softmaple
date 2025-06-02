"use client";

import type { FC } from "react";

import { memo, useState, useEffect } from "react";

import { LEXIAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";

import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";

import { CollabDocEditor } from "@/modules/docs/collab-doc-editor";
import type { CollabDocEditorProps } from "@/modules/docs/collab-doc-editor";

export type DocEditorProps = {
  isPublic?: boolean;
};

const UnMemoizedDocEditor: FC<DocEditorProps> = (props) => {
  const { isPublic = false } = props;

  const [isMounted, setIsMounted] = useState<boolean>(false);

  useEffect(() => {
    // This effect runs only once when the component mounts
    setIsMounted(true);

    return () => {
      // Cleanup if necessary when the component unmounts
      setIsMounted(false);
    };
  }, []);

  if (!isMounted) {
    // If the component is not mounted yet, return null or a loading state
    return null;
  }

  const commonConfig: CollabDocEditorProps["commonEditorConfig"] = {
    ...LEXIAL_PLAYGROUND_CONFIG,
    namespace: "DocEditor",
    onError: (error: unknown) => {
      console.error(error);
      throw error;
    },
  };

  if (isPublic) {
    return <CollabDocEditor commonEditorConfig={commonConfig} />;
  }

  return <CoreEditor lexicalConfig={commonConfig} />;
};

export const DocEditor = memo(UnMemoizedDocEditor);
