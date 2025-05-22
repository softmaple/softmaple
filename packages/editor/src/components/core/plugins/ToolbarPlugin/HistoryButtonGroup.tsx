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
import { SHORTCUTS } from "@/components/core/plugins/ShortcutsPlugin/shortcuts.ts";

type HistoryButtonGroupProps = {
  editor: LexicalEditor;
  toolbarState: ToolbarState;
};

type HistoryButtonConfig = {
  type: string;
  key: string;
  icon: React.ComponentType;
  label: string;
  shortcut: string;
  isDisabled: boolean;
  onClick: () => void;
};

export const HistoryButtonGroup: FC<HistoryButtonGroupProps> = (props) => {
  const { editor, toolbarState } = props;

  const historyButtons: HistoryButtonConfig[] = [
    {
      type: "undo",
      key: "undo",
      icon: Undo,
      label: "Undo",
      shortcut: SHORTCUTS.UNDO,
      isDisabled: !toolbarState.canUndo,
      onClick: () => handleUndo(editor),
    },
    {
      type: "redo",
      key: "redo",
      icon: Redo,
      label: "Redo",
      shortcut: SHORTCUTS.REDO,
      isDisabled: !toolbarState.canRedo,
      onClick: () => handleRedo(editor),
    },
  ];

  const renderButton = (button: HistoryButtonConfig) => {
    const { type, key, icon: Icon, label, shortcut, isDisabled, onClick } = button;
    
    return (
      <Tooltip key={key}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={isDisabled}
            onClick={onClick}
            title={`${label} (${shortcut})`}
          >
            <Icon className="h-4 w-4" />
            <span className="sr-only">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{`${label} (${shortcut})`}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        {historyButtons.map((button) => renderButton(button))}
      </div>
    </TooltipProvider>
  );
};
