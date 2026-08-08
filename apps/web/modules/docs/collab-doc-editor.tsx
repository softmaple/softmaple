"use client";

import type { FC } from "react";
import { useState } from "react";
import { LexicalEgWalkerPlugin } from "@softmaple/binding-lexical/react";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
import { LEXICAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import type { EditorProps } from "@softmaple/editor/components/core/Editor";
import { useCollabDocument } from "@/modules/docs/use-collab-document";
import { useEditorState } from "@/contexts/EditorStateContext";

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
  const collab = useCollabDocument(documentId, true);
  const [bindingError, setBindingError] = useState<Error | null>(null);

  const lexicalConfig: InitialConfigType = {
    ...LEXICAL_PLAYGROUND_CONFIG,
    ...commonEditorConfig,
    namespace: `CollabDoc:${documentId}`,
    editable: false,
  };

  const ready = Boolean(collab.replica && collab.snapshot?.ready);
  const runtimeError = collab.error ?? bindingError;

  if (!ready) {
    if (runtimeError) {
      return (
        <div
          className="p-6 text-sm text-destructive"
          data-testid="collab-error"
        >
          {runtimeError.message}
        </div>
      );
    }
    const durability = collab.snapshot?.durability ?? "loading";
    const connection = collab.snapshot?.connectionState ?? "connecting";
    return (
      <div
        className="grid h-full place-items-center p-8 text-center text-muted-foreground"
        data-testid="collab-loading"
        data-connection={connection}
        data-durability={durability}
      >
        <div>
          <p className="font-medium text-foreground">Restoring document…</p>
          <p className="mt-1 text-xs">
            Local cache, auth, and repair finish before editing opens.
            {connection === "offline" || durability === "offline-pending"
              ? " Offline — edits will sync when the connection returns."
              : null}
          </p>
        </div>
      </div>
    );
  }

  const statusLabel =
    collab.snapshot!.durability === "saved"
      ? "Saved"
      : collab.snapshot!.durability === "pending"
        ? "Pending"
        : collab.snapshot!.durability === "offline-pending"
          ? "Offline / Pending"
          : "Loading";

  return (
    <div className="relative h-full" data-testid="collab-ready">
      {runtimeError ? (
        <div
          className="absolute top-2 left-4 z-10 max-w-md rounded bg-destructive/10 px-2 py-1 text-xs text-destructive"
          data-testid="collab-error-banner"
        >
          {runtimeError.message}
        </div>
      ) : null}
      <div
        className="absolute top-2 right-4 z-10 rounded bg-muted/80 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
        data-testid="collab-status"
        data-durability={collab.snapshot!.durability}
        data-connection={collab.snapshot!.connectionState}
      >
        {statusLabel}
      </div>
      <CoreEditor
        activeEditor={activeEditor}
        setActiveEditor={setActiveEditor}
        historyMode="disabled"
        lexicalConfig={lexicalConfig}
      >
        <LexicalEgWalkerPlugin
          replica={collab.replica!}
          enableEditingOnReady={collab.snapshot!.canWrite}
          onBindingChange={collab.onBindingChange}
          onError={setBindingError}
        />
      </CoreEditor>
    </div>
  );
};

/** Convenience wrapper that reads the active editor from context. */
export const CollabDocEditorWithContext: FC<{ documentId: string }> = ({
  documentId,
}) => {
  const { activeEditor, setActiveEditor } = useEditorState();
  return (
    <CollabDocEditor
      documentId={documentId}
      activeEditor={activeEditor}
      setActiveEditor={setActiveEditor}
    />
  );
};
