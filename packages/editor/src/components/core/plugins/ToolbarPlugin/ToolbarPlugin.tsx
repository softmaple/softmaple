import type { Dispatch, FC, SetStateAction } from "react";
import { useState, useEffect, useCallback } from "react";
import type { LexicalEditor, NodeKey } from "lexical";
import {
  $getSelection,
  $isRangeSelection,
  $isRootOrShadowRoot,
  // $isElementNode,
  CAN_UNDO_COMMAND,
  COMMAND_PRIORITY_CRITICAL,
  CAN_REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import { Separator } from "@softmaple/ui/components/separator";
import {
  $findMatchingParent,
  mergeRegister,
  $getNearestNodeOfType,
} from "@lexical/utils";
import { BlockFormatDropdown } from "@softmaple/editor/components/core/plugins/ToolbarPlugin/BlockFormatDropdown";
import { useToolbarState } from "@softmaple/editor/context/ToolbarContext";
import { $isTableNode, $isTableSelection } from "@lexical/table";
import { getSelectedNode } from "@softmaple/editor/utils/getSelectedNode";
// import { $isLinkNode } from "@lexical/link";
import { $isListNode, ListNode } from "@lexical/list";
import { $isHeadingNode } from "@lexical/rich-text";
import { FormatButtonGroup } from "@softmaple/editor/components/core/plugins/ToolbarPlugin/FormatButtonGroup";
import { HistoryButtonGroup } from "@softmaple/editor/components/core/plugins/ToolbarPlugin/HistoryButtonGroup";
import { blockTypeToBlockName } from "@softmaple/editor/constants/toolbar";

type ToolbarPluginProps = {
  editor: LexicalEditor;
  activeEditor: LexicalEditor;
  setActiveEditor: Dispatch<SetStateAction<LexicalEditor>>;
  setIsLinkEditMode: Dispatch<SetStateAction<boolean>>;
};

export const ToolbarPlugin: FC<ToolbarPluginProps> = (props) => {
  const { editor, activeEditor, setActiveEditor } = props;

  const [, setSelectedElementKey] = useState<NodeKey | null>(null);
  const [, setIsEditable] = useState(() => editor.isEditable());
  const { toolbarState, updateToolbarState } = useToolbarState();

  const $updateToolbar = useCallback(() => {
    const selection = $getSelection();
    if ($isRangeSelection(selection)) {
      // if (activeEditor !== editor && $isEditorIsNestedEditor(activeEditor)) {
      //   const rootElement = activeEditor.getRootElement();
      //   updateToolbarState(
      //     'isImageCaption',
      //     !!rootElement?.parentElement?.classList.contains(
      //       'image-caption-container',
      //     ),
      //   );
      // } else {
      //   updateToolbarState('isImageCaption', false);
      // }

      const anchorNode = selection.anchor.getNode();
      let element =
        anchorNode.getKey() === "root"
          ? anchorNode
          : $findMatchingParent(anchorNode, (e) => {
              const parent = e.getParent();
              return parent !== null && $isRootOrShadowRoot(parent);
            });

      if (element === null) {
        element = anchorNode.getTopLevelElementOrThrow();
      }

      const elementKey = element.getKey();
      const elementDOM = activeEditor.getElementByKey(elementKey);

      // updateToolbarState('isRTL', $isParentElementRTL(selection));

      // Update links
      const node = getSelectedNode(selection);
      // const parent = node.getParent();
      // const isLink = $isLinkNode(parent) || $isLinkNode(node);
      // updateToolbarState('isLink', isLink);

      const tableNode = $findMatchingParent(node, $isTableNode);
      if ($isTableNode(tableNode)) {
        updateToolbarState("rootType", "table");
      } else {
        updateToolbarState("rootType", "root");
      }

      if (elementDOM !== null) {
        setSelectedElementKey(elementKey);
        if ($isListNode(element)) {
          const parentList = $getNearestNodeOfType<ListNode>(
            anchorNode,
            ListNode,
          );
          const type = parentList
            ? parentList.getListType()
            : element.getListType();

          updateToolbarState("blockType", type);
        } else {
          const type = $isHeadingNode(element)
            ? element.getTag()
            : element.getType();
          if (type in blockTypeToBlockName) {
            updateToolbarState(
              "blockType",
              type as keyof typeof blockTypeToBlockName,
            );
          }
          // if ($isCodeNode(element)) {
          // const language =
          //   element.getLanguage() as keyof typeof CODE_LANGUAGE_MAP;
          // updateToolbarState(
          //   "codeLanguage",
          //   language ? CODE_LANGUAGE_MAP[language] || language : ""
          // );
          //   return;
          // }
        }
      }
      // Handle buttons
      // let matchingParent;
      // if ($isLinkNode(parent)) {
      //   // If node is a link, we need to fetch the parent paragraph node to set format
      //   matchingParent = $findMatchingParent(
      //     node,
      //     (parentNode) => $isElementNode(parentNode) && !parentNode.isInline()
      //   );
      // }
      //
      // // If matchingParent is a valid node, pass it's format type
      // updateToolbarState(
      //   "elementFormat",
      //   $isElementNode(matchingParent)
      //     ? matchingParent.getFormatType()
      //     : $isElementNode(node)
      //     ? node.getFormatType()
      //     : parent?.getFormatType() || "left"
      // );
    }
    if ($isRangeSelection(selection) || $isTableSelection(selection)) {
      // Update text format
      updateToolbarState("isBold", selection.hasFormat("bold"));
      updateToolbarState("isItalic", selection.hasFormat("italic"));
      updateToolbarState("isUnderline", selection.hasFormat("underline"));
      updateToolbarState(
        "isStrikethrough",
        selection.hasFormat("strikethrough"),
      );
      // updateToolbarState("isSubscript", selection.hasFormat("subscript"));
      // updateToolbarState("isSuperscript", selection.hasFormat("superscript"));
      // updateToolbarState("isHighlight", selection.hasFormat("highlight"));
      updateToolbarState("isCode", selection.hasFormat("code"));
      // updateToolbarState(
      //   "fontSize",
      //   $getSelectionStyleValueForProperty(selection, "font-size", "15px")
      // );
      // updateToolbarState("isLowercase", selection.hasFormat("lowercase"));
      // updateToolbarState("isUppercase", selection.hasFormat("uppercase"));
      // updateToolbarState("isCapitalize", selection.hasFormat("capitalize"));
    }
  }, [activeEditor, editor, updateToolbarState]);

  useEffect(() => {
    return editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      (_payload, newEditor) => {
        setActiveEditor(newEditor);
        $updateToolbar();
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );
  }, [editor, $updateToolbar, setActiveEditor]);

  useEffect(() => {
    activeEditor.getEditorState().read(() => {
      $updateToolbar();
    });
  }, [activeEditor, $updateToolbar]);

  useEffect(() => {
    return mergeRegister(
      editor.registerEditableListener((editable) => {
        setIsEditable(editable);
      }),
      activeEditor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          $updateToolbar();
        });
      }),
      activeEditor.registerCommand<boolean>(
        CAN_UNDO_COMMAND,
        (payload) => {
          updateToolbarState("canUndo", payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
      activeEditor.registerCommand<boolean>(
        CAN_REDO_COMMAND,
        (payload) => {
          updateToolbarState("canRedo", payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL,
      ),
    );
  }, [$updateToolbar, activeEditor, editor, updateToolbarState]);

  return (
    <div className="flex flex-wrap items-center gap-1 p-2 border-b">
      <HistoryButtonGroup editor={activeEditor} toolbarState={toolbarState} />
      <Separator orientation="vertical" className="h-6" />

      {toolbarState.blockType in blockTypeToBlockName &&
        activeEditor === editor && (
          <>
            <BlockFormatDropdown
              editor={activeEditor}
              blockType={toolbarState.blockType}
            />
            <Separator orientation="vertical" className="h-6" />
          </>
        )}

      <FormatButtonGroup editor={activeEditor} toolbarState={toolbarState} />
      <Separator orientation="vertical" className="h-6" />
    </div>
  );
};
