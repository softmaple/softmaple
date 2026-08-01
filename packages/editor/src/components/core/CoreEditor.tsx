import type { FC, ReactNode } from "react";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { Providers } from "@softmaple/editor/components/core/Providers";
import { Editor } from "@softmaple/editor/components/core/Editor";
import { LEXICAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import type { EditorProps } from "@softmaple/editor/components/core/Editor";
import {
  DEFAULT_EDITOR_HISTORY_MODE,
  resolveCoreEditorLayoutClassName,
} from "@softmaple/editor/components/core/editorOptions";

export type CoreEditorProps = Pick<
  EditorProps,
  "activeEditor" | "historyMode" | "setActiveEditor"
> & {
  lexicalConfig?: InitialConfigType;
  children?: ReactNode;
  /** Additional classes merged onto the default editor layout container. */
  layoutClassName?: string;
};

export const CoreEditor: FC<CoreEditorProps> = (props) => {
  const {
    lexicalConfig = LEXICAL_PLAYGROUND_CONFIG,
    children,
    activeEditor,
    historyMode = DEFAULT_EDITOR_HISTORY_MODE,
    layoutClassName,
    setActiveEditor,
  } = props;

  return (
    <LexicalComposer initialConfig={lexicalConfig}>
      <Providers>
        <div className={resolveCoreEditorLayoutClassName(layoutClassName)}>
          <Editor
            activeEditor={activeEditor}
            historyMode={historyMode}
            setActiveEditor={setActiveEditor}
          >
            {children}
          </Editor>
        </div>
      </Providers>
    </LexicalComposer>
  );
};
