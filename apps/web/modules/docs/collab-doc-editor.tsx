"use client";

import { type FC, useEffect } from "react";
import { LexicalEgWalkerPlugin } from "@softmaple/binding-lexical/react";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
import { LEXICAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import type { EditorProps } from "@softmaple/editor/components/core/Editor";
import { useCollabDocument } from "@/modules/docs/use-collab-document";
import type { CollabDocumentState } from "@/modules/docs/use-collab-document";

export type CollabDocEditorProps = Pick<
  EditorProps,
  "activeEditor" | "setActiveEditor"
> & {
  documentId: string;
  commonEditorConfig?: InitialConfigType;
};

const CollabBindingPlugin: FC<{
  canWrite: CollabDocumentState["canWrite"];
  onBindingChange: CollabDocumentState["onBindingChange"];
  replica: NonNullable<CollabDocumentState["replica"]>;
}> = ({ canWrite, onBindingChange, replica }) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(canWrite);
  }, [canWrite, editor]);

  return (
    <LexicalEgWalkerPlugin
      replica={replica}
      enableEditingOnReady={false}
      onBindingChange={onBindingChange}
      onError={(error) => console.error("Collaboration binding failed", error)}
    />
  );
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
      <div
        aria-atomic="true"
        aria-live="polite"
        className="absolute right-6 top-3 z-20 rounded-full border bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm"
        role="status"
      >
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
        <CollabBindingPlugin
          canWrite={collaboration.canWrite}
          onBindingChange={collaboration.onBindingChange}
          replica={collaboration.replica}
        />
      </CoreEditor>
    </div>
  );
};
