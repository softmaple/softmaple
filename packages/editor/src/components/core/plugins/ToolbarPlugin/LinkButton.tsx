import type { FC } from "react";
import { TOGGLE_LINK_COMMAND, formatUrl } from "@lexical/link";
import { Link as LinkIcon } from "lucide-react";
import type { LexicalEditor } from "lexical";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@softmaple/ui/components/tooltip";
import { Button } from "@softmaple/ui/components/button";
import { SHORTCUTS } from "@softmaple/editor/components/core/plugins/ShortcutsPlugin/shortcuts";
import type { ToolbarState } from "@softmaple/editor/context/ToolbarContext";
import { isSafeUrl } from "@softmaple/editor/utils/sanitizeUrl";

type LinkButtonProps = {
  editor: LexicalEditor;
  toolbarState: ToolbarState;
};

export const LinkButton: FC<LinkButtonProps> = ({ editor, toolbarState }) => {
  const isActive = toolbarState.isLink;

  const handleClick = () => {
    if (isActive) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);
      return;
    }
    const input = window.prompt("Enter URL", "https://");
    if (input === null) {
      return;
    }
    const trimmed = input.trim();
    if (trimmed === "") {
      return;
    }
    const formatted = formatUrl(trimmed);
    if (!isSafeUrl(formatted)) {
      return;
    }
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, formatted);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={isActive ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8"
            title={`Link (${SHORTCUTS.INSERT_LINK})`}
            onClick={handleClick}
            aria-pressed={isActive}
          >
            <LinkIcon className="h-4 w-4" />
            <span className="sr-only">Link</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <span>{isActive ? "Remove link" : "Insert link"}</span>
          <span className="hidden md:inline"> ({SHORTCUTS.INSERT_LINK})</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
