import type { FC } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { Providers } from "@/components/core/Providers.tsx";
import type { EditorThemeClasses } from "lexical";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";

const theme: EditorThemeClasses = {
  // Theme styling goes here
  //...
};

// Catch any errors that occur during Lexical updates and log them
// or throw them as needed. If you don't throw them, Lexical will
// try to recover gracefully without losing user data.
const onError = (error: Error) => {
  throw error;
};

type EditorProps = unknown;

export const Editor: FC<EditorProps> = () => {
  const initConfig: InitialConfigType = {
    namespace: "Playground",
    theme,
    onError,
  };

  return (
    <LexicalComposer initialConfig={initConfig}>
      <Providers>
        <RichTextPlugin
          contentEditable={
            // @ts-expect-error lexical type incompatible
            <ContentEditable
              aria-placeholder={"Enter some text..."}
              placeholder={<div>Enter some text...</div>}
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
      </Providers>
    </LexicalComposer>
  );
};
