import type { FC } from "react";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { Providers } from "@/components/core/Providers.tsx";
import type { EditorThemeClasses } from "lexical";
import { Editor } from "@/components/core/Editor.tsx";

const theme: EditorThemeClasses = {
  // Theme styling goes here
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    underlineStrikethrough: "line-through underline",
  },
};

// Catch any errors that occur during Lexical updates and log them
// or throw them as needed. If you don't throw them, Lexical will
// try to recover gracefully without losing user data.
const onError = (error: Error) => {
  throw error;
};

export const CoreEditor: FC = () => {
  const initConfig: InitialConfigType = {
    namespace: "Playground",
    theme,
    onError,
    nodes: [],
  };

  return (
    <LexicalComposer initialConfig={initConfig}>
      <Providers>
        <div className="mx-12 my-auto max-w-6xl text-black relative leading-1.7 font-normal">
          <Editor />
        </div>
      </Providers>
    </LexicalComposer>
  );
};
