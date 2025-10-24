"use client";

import type { ReactNode, Dispatch, SetStateAction } from "react";
import { createContext, useContext, useState, useMemo } from "react";
import type { LexicalEditor } from "lexical";

type EditorStateContextType = {
  activeEditor?: LexicalEditor;
  setActiveEditor: Dispatch<SetStateAction<LexicalEditor | undefined>>;
};

const Context = createContext<EditorStateContextType | null>(null);

export const EditorStateContext = ({ children }: { children: ReactNode }) => {
  const [activeEditor, setActiveEditor] = useState<LexicalEditor>();

  const contextValue = useMemo(
    () => ({
      activeEditor,
      setActiveEditor,
    }),
    [activeEditor, setActiveEditor],
  );

  return <Context value={contextValue}>{children}</Context>;
};

export const useEditorState = () => {
  const context = useContext(Context);

  if (!context) {
    throw new Error(
      "useEditorState must be used within an EditorStateProvider",
    );
  }

  return context;
};

export const EditorStateProvider = EditorStateContext;
