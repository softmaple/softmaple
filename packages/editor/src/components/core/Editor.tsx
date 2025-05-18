import { useState } from "react";
import type { FC } from "react";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { cn } from "@/lib/utils.ts";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ToolbarPlugin } from "@/components/core/plugins/ToolbarPlugin.tsx";

type EditorProps = {
  className?: string;
};

export const Editor: FC<EditorProps> = (props) => {
  const { className, ...rest } = props;

  const [editor] = useLexicalComposerContext();
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

      <RichTextPlugin
        contentEditable={
          <div className={cn("border rounded-md", className)} {...rest}>
            <div>
              <ContentEditable
                aria-placeholder={"Enter some rich text..."}
                placeholder={<div>Enter some rich text...</div>}
              />
            </div>
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
    </>
  );
};
