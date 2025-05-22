import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import { Button } from "@/components/ui/button.tsx";
import { SHORTCUTS } from "@/components/core/plugins/ShortcutsPlugin/shortcuts.ts";
import { formatText } from "@/components/core/plugins/ToolbarPlugin/utils.ts";
import { Bold, Code, Italic, Strikethrough, Underline } from "lucide-react";
import type { LexicalEditor } from "lexical";
import type { ToolbarState } from "@/context/ToolbarContext.tsx";
import type { FC } from "react";

type FormatButtonGroupProps = {
  editor: LexicalEditor;
  toolbarState: ToolbarState;
};

export const FormatButtonGroup: FC<FormatButtonGroupProps> = (props) => {
  const { editor, toolbarState } = props;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={toolbarState.isBold ? "secondary" : "ghost"}
              size="icon"
              className={"h-8 w-8"}
              title={`Bold (${SHORTCUTS.BOLD})`}
              onClick={() => formatText(editor, "bold")}
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
              variant={toolbarState.isItalic ? "secondary" : "ghost"}
              size="icon"
              className={"h-8 w-8"}
              title={`Italic (${SHORTCUTS.ITALIC})`}
              onClick={() => formatText(editor, "italic")}
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
              variant={toolbarState.isUnderline ? "secondary" : "ghost"}
              size="icon"
              className={"h-8 w-8"}
              title={`Underline (${SHORTCUTS.UNDERLINE})`}
              onClick={() => formatText(editor, "underline")}
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
              variant={toolbarState.isStrikethrough ? "secondary" : "ghost"}
              size="icon"
              className={"h-8 w-8"}
              title={`Strikethrough (${SHORTCUTS.STRIKETHROUGH})`}
              onClick={() => formatText(editor, "strikethrough")}
            >
              <Strikethrough className="h-4 w-4" />
              <span className="sr-only">Strikethrough</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{`Strikethrough (${SHORTCUTS.STRIKETHROUGH})`}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={toolbarState.isCode ? "secondary" : "ghost"}
              size="icon"
              className={"h-8 w-8"}
              title={`Inline code (${SHORTCUTS.INSERT_CODE_BLOCK})`}
              onClick={() => formatText(editor, "code")}
            >
              <Code className="h-4 w-4" />
              <span className="sr-only">Inline Code</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{`Inline code  (${SHORTCUTS.INSERT_CODE_BLOCK})`}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
};
