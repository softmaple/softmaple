import type { FC } from "react";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { Providers } from "@softmaple/editor/components/core/Providers";
import type { EditorThemeClasses } from "lexical";
import { Editor } from "@softmaple/editor/components/core/Editor";
import { PlaygroundNodes } from "@softmaple/editor/nodes/PlaygroundNodes";

const theme: EditorThemeClasses = {
  // Theme styling goes here
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "line-through",
    underlineStrikethrough: "line-through underline",
    // TODO: fix the code styles
    code: "",
  },
  heading: {
    h1: "text-4xl font-bold my-4",
    h2: "text-3xl font-bold my-3.5",
    h3: "text-2xl font-bold my-3",
  },
  paragraph: "",
  list: {
    ul: "list-disc list-inside ml-4 my-2",
    ol: "list-decimal list-inside ml-4 my-2",
    // TODO: fix the checklist styles
    checklist: "",
    listitem: "my-1",
    // TODO: fix the checklist styles
    listitemUnchecked: "",
    // TODO: fix the checklist styles
    listitemChecked: "line-through",
    nested: {
      listitem: "ml-4",
    },
  },
  quote: "border-l-4 border-border pl-4 my-4 italic",
  link: "",
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
    nodes: [...PlaygroundNodes],
  };

  return (
    <LexicalComposer initialConfig={initConfig}>
      <Providers>
        <div className="mx-12 my-auto max-w-6xl text-foreground relative leading-1.7 font-normal">
          <Editor />
        </div>
      </Providers>
    </LexicalComposer>
  );
};
