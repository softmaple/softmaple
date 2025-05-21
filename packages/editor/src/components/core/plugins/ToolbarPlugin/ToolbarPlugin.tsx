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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  // List,
  // ListOrdered,
  // Link,
  // ImageIcon,
  // Code,
  // Quote,
  Undo,
  Redo,
  // Type,
  // Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Separator } from "@/components/ui/separator.tsx";
import {
  IS_APPLE,
  $findMatchingParent,
  mergeRegister,
  // $isEditorIsNestedEditor,
  $getNearestNodeOfType,
} from "@lexical/utils";
import { BlockFormatDropdown } from "@/components/core/plugins/ToolbarPlugin/BlockFormatDropdown.tsx";
import { SHORTCUTS } from "@/components/core/plugins/ShortcutsPlugin/shortcuts.ts";
import {
  blockTypeToBlockName,
  useToolbarState,
} from "@/context/ToolbarContext.tsx";
import {
  formatText,
  handleRedo,
  handleUndo,
} from "@/components/core/plugins/ToolbarPlugin/utils.ts";
import { $isTableNode, $isTableSelection } from "@lexical/table";
import { getSelectedNode } from "@/utils/getSelectedNode";
// import { $isLinkNode } from "@lexical/link";
import { $isListNode, ListNode } from "@lexical/list";
import { $isHeadingNode } from "@lexical/rich-text";
import { cn } from "@/lib/utils.ts";

type ToolbarPluginProps = {
  editor: LexicalEditor;
  activeEditor: LexicalEditor;
  setActiveEditor: Dispatch<SetStateAction<LexicalEditor>>;
  setIsLinkEditMode: Dispatch<SetStateAction<boolean>>;
};

export const ToolbarPlugin: FC<ToolbarPluginProps> = (props) => {
  const {
    editor,
    activeEditor,
    setActiveEditor,
    // @ts-expect-error TODO: use it when `link` node available.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setIsLinkEditMode,
  } = props;

  // @ts-expect-error TODO: use it when `floatingAnchorElem` available.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [selectedElementKey, setSelectedElementKey] = useState<NodeKey | null>(
    null
  );
  // @ts-expect-error TODO: use it when `readonly` mode available.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [isEditable, setIsEditable] = useState(() => editor.isEditable());
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
            ListNode
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
              type as keyof typeof blockTypeToBlockName
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
      // updateToolbarState(
      //   "fontColor",
      //   $getSelectionStyleValueForProperty(selection, "color", "#000")
      // );
      // updateToolbarState(
      //   "bgColor",
      //   $getSelectionStyleValueForProperty(
      //     selection,
      //     "background-color",
      //     "#fff"
      //   )
      // );
      // updateToolbarState(
      //   "fontFamily",
      //   $getSelectionStyleValueForProperty(selection, "font-family", "Arial")
      // );
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
        selection.hasFormat("strikethrough")
      );
      // updateToolbarState("isSubscript", selection.hasFormat("subscript"));
      // updateToolbarState("isSuperscript", selection.hasFormat("superscript"));
      // updateToolbarState("isHighlight", selection.hasFormat("highlight"));
      // updateToolbarState("isCode", selection.hasFormat("code"));
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
      COMMAND_PRIORITY_CRITICAL
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
        COMMAND_PRIORITY_CRITICAL
      ),
      activeEditor.registerCommand<boolean>(
        CAN_REDO_COMMAND,
        (payload) => {
          updateToolbarState("canRedo", payload);
          return false;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    );
  }, [$updateToolbar, activeEditor, editor, updateToolbarState]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-wrap items-center gap-1 p-2 border-b">
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!toolbarState.canUndo}
                onClick={() => handleUndo(activeEditor)}
                title={IS_APPLE ? "Undo (⌘Z)" : "Undo (Ctrl+Z)"}
              >
                <Undo className="h-4 w-4" />
                <span className="sr-only">Undo</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {IS_APPLE ? "Undo (⌘Z)" : "Undo (Ctrl+Z)"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                disabled={!toolbarState.canRedo}
                onClick={() => handleRedo(editor)}
                title={IS_APPLE ? "Redo (⇧⌘Z)" : "Redo (Ctrl+Y)"}
              >
                <Redo className="h-4 w-4" />
                <span className="sr-only">Redo</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {IS_APPLE ? "Redo (⇧⌘Z)" : "Redo (Ctrl+Y)"}
            </TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {activeEditor === editor && (
          <>
            <BlockFormatDropdown />

            <Separator orientation="vertical" className="h-6" />
          </>
        )}

        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("h-8 w-8", toolbarState.isBold && "bg-gray-200")}
                title={`Bold (${SHORTCUTS.BOLD})`}
                onClick={() => formatText(activeEditor, "bold")}
              >
                <Bold className="h-4 w-4" />
                <span className="sr-only">Bold</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`Bold (${SHORTCUTS.BOLD})`}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8",
                  toolbarState.isItalic && "bg-gray-200"
                )}
                title={`Italic (${SHORTCUTS.ITALIC})`}
                onClick={() => formatText(activeEditor, "italic")}
              >
                <Italic className="h-4 w-4" />
                <span className="sr-only">Italic</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`Italic (${SHORTCUTS.ITALIC})`}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8",
                  toolbarState.isUnderline && "bg-gray-200"
                )}
                title={`Underline (${SHORTCUTS.UNDERLINE})`}
                onClick={() => formatText(activeEditor, "underline")}
              >
                <Underline className="h-4 w-4" />
                <span className="sr-only">Underline</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`Underline (${SHORTCUTS.UNDERLINE})`}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8",
                  toolbarState.isStrikethrough && "bg-gray-200"
                )}
                title={`Strikethrough (${SHORTCUTS.STRIKETHROUGH})`}
                onClick={() => formatText(activeEditor, "strikethrough")}
              >
                <Strikethrough className="h-4 w-4" />
                <span className="sr-only">Strikethrough</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{`Strikethrough (${SHORTCUTS.STRIKETHROUGH})`}</TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-6" />
      </div>
    </TooltipProvider>
  );
};
