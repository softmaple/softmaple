import type { LexicalEditor } from "lexical";
import type { ToolbarState } from "@softmaple/editor/context/ToolbarContext.tsx";
import type { FC } from "react";
import {
  Tooltip,
  TooltipProvider,
  TooltipContent,
  TooltipTrigger,
} from "@softmaple/ui/components/tooltip";
import { Button } from "@softmaple/ui/components/button";
import {
  handleRedo,
  handleUndo,
} from "@softmaple/editor/components/core/plugins/ToolbarPlugin/utils.ts";
import { Redo, Undo } from "lucide-react";
import { SHORTCUTS } from "@softmaple/editor/components/core/plugins/ShortcutsPlugin/shortcuts.ts";

type HistoryButtonGroupProps = {
  editor: LexicalEditor;
  toolbarState: ToolbarState;
};

type HistoryButtonConfig = {
  key: string;
  icon: React.ComponentType;
  label: string;
  shortcut: (typeof SHORTCUTS)[keyof typeof SHORTCUTS];
  isDisabled: boolean;
  onClick: VoidFunction;
};

export const HistoryButtonGroup: FC<HistoryButtonGroupProps> = (props) => {
  const { editor, toolbarState } = props;

  const historyButtons: HistoryButtonConfig[] = [
    {
      key: "undo",
      icon: Undo,
      label: "Undo",
      shortcut: SHORTCUTS.UNDO,
      isDisabled: !toolbarState.canUndo,
      onClick: () => handleUndo(editor),
    },
    {
      key: "redo",
      icon: Redo,
      label: "Redo",
      shortcut: SHORTCUTS.REDO,
      isDisabled: !toolbarState.canRedo,
      onClick: () => handleRedo(editor),
    },
  ];

  const renderButton = (button: HistoryButtonConfig) => {
    const { key, icon: Icon, label, shortcut, isDisabled, onClick } = button;

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
            {/* @ts-expect-error TODO: fix it */}
            <Icon className="h-4 w-4" />
            <span className="sr-only">{label}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span>{label}</span>
          <span className="hidden md:inline"> ({shortcut})</span>
        </TooltipContent>
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
