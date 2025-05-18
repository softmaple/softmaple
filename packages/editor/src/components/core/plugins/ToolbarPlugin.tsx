import type { Dispatch, FC, SetStateAction } from "react";
import type { LexicalEditor } from "lexical";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { Separator } from "@/components/ui/separator";
import { IS_APPLE } from "@lexical/utils";
import { BlockFormatDropdown } from "@/components/core/BlockFormatDropdown.tsx";
import { SHORTCUTS } from "@/components/core/plugins/ShortcutsPlugin/shortcuts.ts";

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
    // setActiveEditor, setIsLinkEditMode
  } = props;

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
                className="h-8 w-8"
                title={`Bold (${SHORTCUTS.BOLD})`}
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
                className="h-8 w-8"
                title={`Italic (${SHORTCUTS.ITALIC})`}
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
                className="h-8 w-8"
                title={`Underline (${SHORTCUTS.UNDERLINE})`}
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
                className="h-8 w-8"
                title={`Strikethrough (${SHORTCUTS.STRIKETHROUGH})`}
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
