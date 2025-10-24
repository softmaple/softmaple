import type { EditorThemeClasses } from "lexical";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { PlaygroundNodes } from "@softmaple/editor/nodes/PlaygroundNodes";

export const LEXICAL_PLAYGROUND_THEME: EditorThemeClasses = {
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

export const LEXIAL_PLAYGROUND_CONFIG: InitialConfigType = {
  namespace: "Playground",
  theme: LEXICAL_PLAYGROUND_THEME,
  onError,
  nodes: [...PlaygroundNodes],
};
