import { useState, Suspense, lazy } from "react";
import type { FC, ReactNode } from "react";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { cn } from "@softmaple/editor/lib/utils";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalContentEditable } from "@softmaple/editor/components/core/LexicalContentEditable";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import { useSharedHistoryContext } from "@softmaple/editor/context/SharedHistoryContext";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";

const ToolbarPlugin = lazy(() =>
  import(
    "@softmaple/editor/components/core/plugins/ToolbarPlugin/ToolbarPlugin"
  ).then((module) => ({ default: module.ToolbarPlugin })),
);
const ShortcutsPlugin = lazy(() =>
  import(
    "@softmaple/editor/components/core/plugins/ShortcutsPlugin/ShortcutsPlugin"
  ).then((module) => ({ default: module.ShortcutsPlugin })),
);
const MarkdownPlugin = lazy(() =>
  import(
    "@softmaple/editor/components/core/plugins/MarkdownShortcutPlugin/MarkdownShortcutPlugin"
  ).then((module) => ({ default: module.MarkdownPlugin })),
);

type EditorProps = {
  className?: string;
  children?: ReactNode;
};

export const Editor: FC<EditorProps> = (props) => {
  const { className, children, ...rest } = props;

  const [editor] = useLexicalComposerContext();
  const { historyState } = useSharedHistoryContext();

  const [activeEditor, setActiveEditor] = useState(editor);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, setIsLinkEditMode] = useState<boolean>(false);

  return (
    <>
      <Suspense
        fallback={<div className="h-12 bg-background border-b animate-pulse" />}
      >
        <ToolbarPlugin
          editor={editor}
          activeEditor={activeEditor}
          setActiveEditor={setActiveEditor}
          setIsLinkEditMode={setIsLinkEditMode}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ShortcutsPlugin
          editor={activeEditor}
          setIsLinkEditMode={setIsLinkEditMode}
        />
      </Suspense>

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

        {children}

        <Suspense fallback={null}>
          <MarkdownPlugin />
        </Suspense>
        <ListPlugin hasStrictIndent />
        <CheckListPlugin />
      </div>
    </>
  );
};
