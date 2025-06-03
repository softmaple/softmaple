import type { FC, ReactNode } from "react";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { Providers } from "@softmaple/editor/components/core/Providers";
import { Editor } from "@softmaple/editor/components/core/Editor";
import { LEXIAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import type { EditorProps } from "@softmaple/editor/components/core/Editor";

export type CoreEditorProps = Pick<
  EditorProps,
  "activeEditor" | "setActiveEditor"
> & {
  lexicalConfig?: InitialConfigType;
  children?: ReactNode;
};

export const CoreEditor: FC<CoreEditorProps> = (props) => {
  const {
    lexicalConfig = LEXIAL_PLAYGROUND_CONFIG,
    children,
    activeEditor,
    setActiveEditor,
  } = props;

  return (
    <LexicalComposer initialConfig={lexicalConfig}>
      <Providers>
        <div className="mx-12 my-auto max-w-6xl text-foreground relative leading-1.7 font-normal">
          <Editor activeEditor={activeEditor} setActiveEditor={setActiveEditor}>
            {children}
          </Editor>
        </div>
      </Providers>
    </LexicalComposer>
  );
};
