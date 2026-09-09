import type { BlockReplica } from "@softmaple/block-model";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useEffect, useRef } from "react";
import {
  createLexicalBinding,
  type LexicalBinding,
  type StableBlockSelection,
} from "./binding";

export interface LexicalEgWalkerPluginProps {
  readonly mode?: "editable" | "read-only";
  readonly replica: BlockReplica;
  readonly enableEditingOnReady?: boolean;
  readonly onBindingChange?: (binding: LexicalBinding | null) => void;
  readonly onError?: (error: Error) => void;
  readonly onSelectionChange?: (selection: StableBlockSelection | null) => void;
}

/** React lifecycle wrapper around the framework-free Lexical binding. */
export function LexicalEgWalkerPlugin({
  mode,
  replica,
  enableEditingOnReady,
  onBindingChange,
  onError,
  onSelectionChange,
}: LexicalEgWalkerPluginProps) {
  const [editor] = useLexicalComposerContext();
  const callbacksRef = useRef({
    onBindingChange,
    onError,
    onSelectionChange,
  });

  useEffect(() => {
    callbacksRef.current = {
      onBindingChange,
      onError,
      onSelectionChange,
    };
  }, [onBindingChange, onError, onSelectionChange]);

  useEffect(() => {
    const binding = createLexicalBinding({
      mode,
      editor,
      replica,
      enableEditingOnReady,
      onError: (error) => {
        const handler = callbacksRef.current.onError;
        if (handler === undefined) throw error;
        handler(error);
      },
      onSelectionChange: (selection) =>
        callbacksRef.current.onSelectionChange?.(selection),
    });
    callbacksRef.current.onBindingChange?.(binding);

    return () => {
      callbacksRef.current.onBindingChange?.(null);
      binding.destroy();
    };
  }, [editor, enableEditingOnReady, mode, replica]);

  return null;
}
