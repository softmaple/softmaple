import type { FC, ReactNode } from "react";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { Providers } from "@softmaple/editor/components/core/Providers";
import { Editor } from "@softmaple/editor/components/core/Editor";
import { LEXIAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";

export type CoreEditorProps = {
  lexicalConfig?: InitialConfigType;
  children?: ReactNode;
};

export const CoreEditor: FC<CoreEditorProps> = (props) => {
  const { lexicalConfig = LEXIAL_PLAYGROUND_CONFIG, children } = props;

  return (
    <LexicalComposer initialConfig={lexicalConfig}>
      <Providers>
        <div className="mx-12 my-auto max-w-6xl text-foreground relative leading-1.7 font-normal">
          <Editor>{children}</Editor>
        </div>
      </Providers>
    </LexicalComposer>
  );
};
