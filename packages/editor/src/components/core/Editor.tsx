import { useState, useEffect } from "react";
import type { FC, ReactNode, Dispatch, SetStateAction } from "react";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { cn } from "@softmaple/editor/lib/utils";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ToolbarPlugin } from "@softmaple/editor/components/core/plugins/ToolbarPlugin/ToolbarPlugin";
import { LexicalContentEditable } from "@softmaple/editor/components/core/LexicalContentEditable";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { useSharedHistoryContext } from "@softmaple/editor/context/SharedHistoryContext";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ShortcutsPlugin } from "@softmaple/editor/components/core/plugins/ShortcutsPlugin/ShortcutsPlugin";
import { MarkdownPlugin } from "@softmaple/editor/components/core/plugins/MarkdownShortcutPlugin/MarkdownShortcutPlugin";
import { isSafeUrl } from "@softmaple/editor/utils/sanitizeUrl";
import type { LexicalEditor } from "lexical";
import {
  DEFAULT_EDITOR_HISTORY_MODE,
  isLocalEditorHistoryEnabled,
  type EditorHistoryMode,
} from "@softmaple/editor/components/core/editorOptions";

export type { EditorHistoryMode } from "@softmaple/editor/components/core/editorOptions";

export type EditorProps = {
  className?: string;
  children?: ReactNode;
  historyMode?: EditorHistoryMode;
  showToolbar?: boolean;
  activeEditor: LexicalEditor | undefined;
  setActiveEditor: Dispatch<SetStateAction<LexicalEditor | undefined>>;
};

export const Editor: FC<EditorProps> = (props) => {
  const {
    className,
    children,
    historyMode = DEFAULT_EDITOR_HISTORY_MODE,
    showToolbar = true,
    activeEditor,
    setActiveEditor,
    ...rest
  } = props;

  const [editor] = useLexicalComposerContext();
  const { historyState } = useSharedHistoryContext();

  useEffect(() => {
    // Set the editor instance in the parent component
    setActiveEditor(editor);
  }, [editor, setActiveEditor]);

  const safeSetActiveEditor: Dispatch<SetStateAction<LexicalEditor>> = (
    update,
  ) => {
    setActiveEditor((prev) => {
      if (!prev) throw new Error("Editor is undefined");
      // TypeScript will be happy now
      return typeof update === "function"
        ? (update as (prev: LexicalEditor) => LexicalEditor)(prev)
        : update;
    });
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, setIsLinkEditMode] = useState<boolean>(false);

  if (!activeEditor) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-gray-500">No active editor selected.</p>
      </div>
    );
  }

  return (
    <>
      {showToolbar ? (
        <ToolbarPlugin
          editor={editor}
          activeEditor={activeEditor}
          historyMode={historyMode}
          setActiveEditor={safeSetActiveEditor}
          setIsLinkEditMode={setIsLinkEditMode}
        />
      ) : null}

      <ShortcutsPlugin
        editor={activeEditor}
        setIsLinkEditMode={setIsLinkEditMode}
      />

      <div className="relative block rounded-b-[10px]">
        {isLocalEditorHistoryEnabled(historyMode) ? (
          <HistoryPlugin externalHistoryState={historyState} />
        ) : null}

        <RichTextPlugin
          contentEditable={
            <div
              className={cn(
                "min-h-38 max-w-full border-0 flex relative outline-0 z-0 resize-y",
                className,
              )}
              {...rest}
            >
              <div className="flex-auto max-w-full relative">
                <LexicalContentEditable
                  placeholder={"Enter some rich text..."}
                />
              </div>
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />

        {children}

        <MarkdownPlugin />
        <ListPlugin hasStrictIndent />
        <CheckListPlugin />
        <LinkPlugin validateUrl={isSafeUrl} />
      </div>
    </>
  );
};
