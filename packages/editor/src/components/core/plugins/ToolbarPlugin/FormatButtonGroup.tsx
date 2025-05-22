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
import type { LexicalEditor, TextFormatType } from "lexical";
import type { ToolbarState } from "@/context/ToolbarContext.tsx";
import type { FC } from "react";

type FormatButtonGroupProps = {
  editor: LexicalEditor;
  toolbarState: ToolbarState;
};

export const FormatButtonGroup: FC<FormatButtonGroupProps> = (props) => {
  const { editor, toolbarState } = props;

  const formatButtons = [
    {
      type: "bold",
      icon: Bold,
      label: "Bold",
      shortcut: SHORTCUTS.BOLD,
      isActive: toolbarState.isBold,
    },
    {
      type: "italic",
      icon: Italic,
      label: "Italic",
      shortcut: SHORTCUTS.ITALIC,
      isActive: toolbarState.isItalic,
    },
    {
      type: "underline",
      icon: Underline,
      label: "Underline",
      shortcut: SHORTCUTS.UNDERLINE,
      isActive: toolbarState.isUnderline,
    },
    {
      type: "strikethrough",
      icon: Strikethrough,
      label: "Strikethrough",
      shortcut: SHORTCUTS.STRIKETHROUGH,
      isActive: toolbarState.isStrikethrough,
    },
    {
      type: "code",
      icon: Code,
      label: "Inline Code",
      shortcut: SHORTCUTS.INSERT_CODE_BLOCK,
      isActive: toolbarState.isCode,
    },
  ];

  const renderButton = (
    type: string,
    Icon: any,
    label: string,
    shortcut: string,
    isActive: boolean
  ) => (
    <Tooltip key={type}>
      <TooltipTrigger asChild>
        <Button
          variant={isActive ? "secondary" : "ghost"}
          size="icon"
          className={"h-8 w-8"}
          title={`${label} (${shortcut})`}
          onClick={() => formatText(editor, type as TextFormatType)}
        >
          <Icon className="h-4 w-4" />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>{`${label} (${shortcut})`}</TooltipContent>
    </Tooltip>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1">
        {formatButtons.map((button) =>
          renderButton(
            button.type,
            button.icon,
            button.label,
            button.shortcut,
            button.isActive
          )
        )}
      </div>
    </TooltipProvider>
  );
};
