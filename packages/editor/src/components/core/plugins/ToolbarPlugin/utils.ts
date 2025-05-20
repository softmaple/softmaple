import { FORMAT_TEXT_COMMAND, REDO_COMMAND, UNDO_COMMAND } from "lexical";

import type { LexicalEditor, TextFormatType } from "lexical";

export const handleUndo = (editor: LexicalEditor) => {
  editor.dispatchCommand(UNDO_COMMAND, undefined);
};

export const handleRedo = (editor: LexicalEditor) => {
  editor.dispatchCommand(REDO_COMMAND, undefined);
};

export const formatText = (
  editor: LexicalEditor,
  textFormat: TextFormatType
) => {
  editor.dispatchCommand(FORMAT_TEXT_COMMAND, textFormat);
};
