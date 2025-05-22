import type { LexicalEditor } from "lexical";
import type { ToolbarState } from "@/context/ToolbarContext.tsx";
import type { FC } from "react";
import {
  Tooltip,
  TooltipProvider,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  handleRedo,
  handleUndo,
} from "@/components/core/plugins/ToolbarPlugin/utils.ts";
import { IS_APPLE } from "@lexical/utils";
import { Redo, Undo } from "lucide-react";

type HistoryButtonGroupProps = {
  editor: LexicalEditor;
  toolbarState: ToolbarState;
};

export const HistoryButtonGroup: FC<HistoryButtonGroupProps> = (props) => {
  const { editor, toolbarState } = props;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              disabled={!toolbarState.canUndo}
              onClick={() => handleUndo(editor)}
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
    </TooltipProvider>
  );
};
