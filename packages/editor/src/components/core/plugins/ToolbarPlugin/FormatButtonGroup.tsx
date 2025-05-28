import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@softmaple/ui/components/tooltip";
import { Button } from "@softmaple/ui/components/button";
import { SHORTCUTS } from "@softmaple/editor/components/core/plugins/ShortcutsPlugin/shortcuts.ts";
import { formatText } from "@softmaple/editor/components/core/plugins/ToolbarPlugin/utils.ts";
import { Bold, Code, Italic, Strikethrough, Underline } from "lucide-react";
import type { LexicalEditor, TextFormatType } from "lexical";
import type { ToolbarState } from "@softmaple/editor/context/ToolbarContext.tsx";
import type { FC } from "react";

type FormatButtonGroupProps = {
  editor: LexicalEditor;
  toolbarState: ToolbarState;
};

type FormatButtonConfig = {
  type: TextFormatType;
  key: string;
  icon: React.ComponentType;
  label: string;
  shortcut: (typeof SHORTCUTS)[keyof typeof SHORTCUTS];
  isActive: boolean;
};

export const FormatButtonGroup: FC<FormatButtonGroupProps> = (props) => {
  const { editor, toolbarState } = props;

  const formatButtons: FormatButtonConfig[] = [
    {
      type: "bold",
      key: "bold",
      icon: Bold,
      label: "Bold",
      shortcut: SHORTCUTS.BOLD,
      isActive: toolbarState.isBold,
    },
    {
      type: "italic",
      key: "italic",
      icon: Italic,
      label: "Italic",
      shortcut: SHORTCUTS.ITALIC,
      isActive: toolbarState.isItalic,
    },
    {
      type: "underline",
      key: "underline",
      icon: Underline,
      label: "Underline",
      shortcut: SHORTCUTS.UNDERLINE,
      isActive: toolbarState.isUnderline,
    },
    {
      type: "strikethrough",
      key: "strikethrough",
      icon: Strikethrough,
      label: "Strikethrough",
      shortcut: SHORTCUTS.STRIKETHROUGH,
      isActive: toolbarState.isStrikethrough,
    },
    {
      type: "code",
      key: "code",
      icon: Code,
      label: "Inline Code",
      shortcut: SHORTCUTS.INSERT_CODE_BLOCK,
      isActive: toolbarState.isCode,
    },
  ];

  const renderButton = (button: FormatButtonConfig) => {
    const { type, key, icon: Icon, label, shortcut, isActive } = button;

    return (
      <Tooltip key={key}>
        <TooltipTrigger asChild>
          <Button
            variant={isActive ? "secondary" : "ghost"}
            size="icon"
            className={"h-8 w-8"}
            title={`${label} (${shortcut})`}
            onClick={() => formatText(editor, type)}
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
        {formatButtons.map((button) => renderButton(button))}
      </div>
    </TooltipProvider>
  );
};
