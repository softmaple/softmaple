"use client";

import type { FC } from "react";
import { LexicalEgWalkerPlugin } from "@softmaple/binding-lexical/react";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
import { LEXICAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import type { EditorProps } from "@softmaple/editor/components/core/Editor";
import { useCollabDocument } from "@/modules/docs/use-collab-document";

export type CollabDocEditorProps = Pick<
  EditorProps,
  "activeEditor" | "setActiveEditor"
> & {
  documentId: string;
  commonEditorConfig?: InitialConfigType;
};

export const CollabDocEditor: FC<CollabDocEditorProps> = (props) => {
  const { documentId, commonEditorConfig, activeEditor, setActiveEditor } =
    props;
  const collaboration = useCollabDocument(documentId);

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
      <div className="absolute right-6 top-3 z-20 rounded-full border bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
        {collaboration.status === "saved"
          ? "Saved"
          : collaboration.status === "saving"
            ? "Saving…"
            : collaboration.status === "offline"
              ? "Offline — reconnecting…"
              : collaboration.status === "error"
                ? "Save failed"
                : "Syncing…"}
      </div>
      <CoreEditor
        activeEditor={activeEditor}
        setActiveEditor={setActiveEditor}
        historyMode="disabled"
        lexicalConfig={lexicalConfig}
      >
        <LexicalEgWalkerPlugin
          replica={collaboration.replica}
          enableEditingOnReady={collaboration.canWrite}
          onBindingChange={collaboration.onBindingChange}
          onError={(error) =>
            console.error("Collaboration binding failed", error)
          }
        />
      </CoreEditor>
    </div>
  );
};
