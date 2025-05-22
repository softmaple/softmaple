import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import type { HeadingTagType } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $getSelection,
  // $isRangeSelection,
  FORMAT_TEXT_COMMAND,
  REDO_COMMAND,
  UNDO_COMMAND,
} from "lexical";

import type { LexicalEditor, TextFormatType } from "lexical";
import { $setBlocksType } from "@lexical/selection";
import {
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";

export const handleUndo = (editor: LexicalEditor) => {
  editor.dispatchCommand(UNDO_COMMAND, undefined);
};

export const handleRedo = (editor: LexicalEditor) => {
  editor.dispatchCommand(REDO_COMMAND, undefined);
};

export const formatParagraph = (editor: LexicalEditor) => {
  editor.update(() => {
    const selection = $getSelection();
    $setBlocksType(selection, () => $createParagraphNode());
  });
};

export const formatHeading = (
  editor: LexicalEditor,
  blockType: string,
  headingSize: HeadingTagType
) => {
  if (blockType !== headingSize) {
    editor.update(() => {
      const selection = $getSelection();
      $setBlocksType(selection, () => $createHeadingNode(headingSize));
    });
  }
};

export const formatBulletList = (editor: LexicalEditor, blockType: string) => {
  if (blockType !== "bullet") {
    editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  } else {
    formatParagraph(editor);
  }
};

export const formatCheckList = (editor: LexicalEditor, blockType: string) => {
  if (blockType !== "check") {
    editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
  } else {
    formatParagraph(editor);
  }
};

export const formatNumberedList = (
  editor: LexicalEditor,
  blockType: string
) => {
  if (blockType !== "number") {
    editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  } else {
    formatParagraph(editor);
  }
};

export const formatQuote = (editor: LexicalEditor, blockType: string) => {
  if (blockType !== "quote") {
    editor.update(() => {
      const selection = $getSelection();
      $setBlocksType(selection, () => $createQuoteNode());
    });
  }
};

// export const formatCode = (editor: LexicalEditor, blockType: string) => {
//   if (blockType !== 'code') {
//     editor.update(() => {
//       let selection = $getSelection();
//       if (!selection) {
//         return;
//       }
//       if (!$isRangeSelection(selection) || selection.isCollapsed()) {
//         $setBlocksType(selection, () => $createCodeNode());
//       } else {
//         const textContent = selection.getTextContent();
//         const codeNode = $createCodeNode();
//         selection.insertNodes([codeNode]);
//         selection = $getSelection();
//         if ($isRangeSelection(selection)) {
//           selection.insertRawText(textContent);
//         }
//       }
//     });
//   }
// };

export const formatText = (
  editor: LexicalEditor,
  textFormat: TextFormatType
) => {
  editor.dispatchCommand(FORMAT_TEXT_COMMAND, textFormat);
};
