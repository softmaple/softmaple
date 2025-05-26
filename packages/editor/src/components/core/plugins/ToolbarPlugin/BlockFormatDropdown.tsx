import type { FC, ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Type,
  Text,
  Heading1,
  Heading2,
  Heading3,
  ListOrdered,
  List,
  ListTodo,
  Quote,
} from "lucide-react";
import { SHORTCUTS } from "@/components/core/plugins/ShortcutsPlugin/shortcuts.ts";
import type { LexicalEditor } from "lexical";
import {
  formatParagraph,
  formatHeading,
  formatNumberedList,
  formatBulletList,
  formatCheckList,
  formatQuote,
} from "@/components/core/plugins/ToolbarPlugin/utils.ts";
import type { blockTypeToBlockName } from "@/constants/toolbar.ts";

type BlockFormatType = {
  key: string;
  value: string;
  label: string;
  icon: ReactNode;
  shortcut: (typeof SHORTCUTS)[keyof typeof SHORTCUTS];
};

const ITEMS: BlockFormatType[] = [
  {
    key: "paragraph",
    value: "paragraph",
    label: "Paragraph",
    icon: <Text className="size-4 md:size-4.5" />,
    shortcut: SHORTCUTS.NORMAL,
  },
  {
    key: "h1",
    value: "h1",
    label: "Heading 1",
    icon: <Heading1 className="size-4 md:size-4.5" />,
    shortcut: SHORTCUTS.HEADING1,
  },
  {
    key: "h2",
    value: "h2",
    label: "Heading 2",
    icon: <Heading2 className="size-4 md:size-4.5" />,
    shortcut: SHORTCUTS.HEADING2,
  },
  {
    key: "h3",
    value: "h3",
    label: "Heading 3",
    icon: <Heading3 className="size-4 md:size-4.5" />,
    shortcut: SHORTCUTS.HEADING3,
  },
  {
    key: "number",
    value: "number",
    label: "Numbered List",
    icon: <ListOrdered className="size-4 md:size-4.5" />,
    shortcut: SHORTCUTS.NUMBERED_LIST,
  },
  {
    key: "bullet",
    value: "bullet",
    label: "Bulleted List",
    icon: <List className="size-4 md:size-4.5" />,
    shortcut: SHORTCUTS.BULLET_LIST,
  },
  {
    key: "check",
    value: "check",
    label: "Check List",
    icon: <ListTodo className="size-4 md:size-4.5" />,
    shortcut: SHORTCUTS.CHECK_LIST,
  },
  {
    key: "quote",
    value: "quote",
    label: "Quote",
    icon: <Quote className="size-4 md:size-4.5" />,
    shortcut: SHORTCUTS.QUOTE,
  },
];

type BlockFormatDropdownProps = {
  editor: LexicalEditor;
  blockType: keyof typeof blockTypeToBlockName;
};

export const BlockFormatDropdown: FC<BlockFormatDropdownProps> = (props) => {
  const { editor, blockType } = props;

  const handleChange = (value: string) => {
    switch (value) {
      case "paragraph":
        formatParagraph(editor);
        break;
      case "h1":
        formatHeading(editor, blockType, "h1");
        break;
      case "h2":
        formatHeading(editor, blockType, "h2");
        break;
      case "h3":
        formatHeading(editor, blockType, "h3");
        break;
      case "number":
        formatNumberedList(editor, blockType);
        break;
      case "bullet":
        formatBulletList(editor, blockType);
        break;
      case "check":
        formatCheckList(editor, blockType);
        break;
      case "quote":
        formatQuote(editor, blockType);
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex items-center">
      <Select value={blockType} onValueChange={handleChange}>
        <SelectTrigger className="h-8 min-w-[150px] gap-1">
          <Type className="size-4 md:size-4.5" />
          <SelectValue placeholder="Format" />
        </SelectTrigger>
        <SelectContent>
          {ITEMS.map(({ key, value, label, shortcut, icon }) => (
            <div key={key} className="flex items-center justify-between">
              <span className="text-muted-foreground">{icon}</span>
              <SelectItem key={key} value={value}>
                <span>{label}</span>
              </SelectItem>
              <span className="text-sm text-muted-foreground">{shortcut}</span>
            </div>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};
