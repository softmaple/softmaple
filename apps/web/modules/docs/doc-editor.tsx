"use client";

import type { FC } from "react";

import { memo } from "react";

import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";

import { CollabDocEditor } from "@/modules/docs/collab-doc-editor";
import type { CollabDocEditorProps } from "@/modules/docs/collab-doc-editor";

export type DocEditorProps = {
  isPublic?: boolean;
};

const UnMemoizedDocEditor: FC<DocEditorProps> = (props) => {
  const { isPublic = false } = props;

  const commonConfig: CollabDocEditorProps["commonEditorConfig"] = {
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
