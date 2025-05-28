import { useState } from "react";
import type { FC } from "react";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { cn } from "@softmaple/editor/lib/utils.ts";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ToolbarPlugin } from "@softmaple/editor/components/core/plugins/ToolbarPlugin/ToolbarPlugin.tsx";
import { LexicalContentEditable } from "@softmaple/editor/components/core/LexicalContentEditable.tsx";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { useSharedHistoryContext } from "@softmaple/editor/context/SharedHistoryContext.tsx";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { ShortcutsPlugin } from "@softmaple/editor/components/core/plugins/ShortcutsPlugin/ShortcutsPlugin.tsx";
import { MarkdownPlugin } from "@softmaple/editor/components/core/plugins/MarkdownShortcutPlugin/MarkdownShortcutPlugin.tsx";

type EditorProps = {
  className?: string;
};

export const Editor: FC<EditorProps> = (props) => {
  const { className, ...rest } = props;

  const [editor] = useLexicalComposerContext();
  const { historyState } = useSharedHistoryContext();

  const [activeEditor, setActiveEditor] = useState(editor);

  // @ts-expect-error TODO: use it when `floatingAnchorElem` available.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isLinkEditMode, setIsLinkEditMode] = useState<boolean>(false);

  return (
    <>
      <ToolbarPlugin
        editor={editor}
        activeEditor={activeEditor}
        setActiveEditor={setActiveEditor}
        setIsLinkEditMode={setIsLinkEditMode}
      />

      <ShortcutsPlugin
        editor={activeEditor}
        setIsLinkEditMode={setIsLinkEditMode}
      />

      <div className="bg-background relative block rounded-b-[10px]">
        <HistoryPlugin externalHistoryState={historyState} />

        <RichTextPlugin
          contentEditable={
            <div
              className={cn(
                "min-h-38 max-w-full border-0 flex relative outline-0 z-0 resize-y",
                className,
              )}
              {...rest}
            >
              <div className="flex-auto max-w-full relative resize-y z-[-1]">
                <LexicalContentEditable
                  placeholder={"Enter some rich text..."}
                />
              </div>
            </div>
          }
          ErrorBoundary={LexicalErrorBoundary}
        />

        <MarkdownPlugin />
        <ListPlugin hasStrictIndent />
        <CheckListPlugin />
      </div>
    </>
  );
};
