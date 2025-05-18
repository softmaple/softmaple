import type { FC } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Type } from "lucide-react";
import { SHORTCUTS } from "@/components/core/plugins/ShortcutsPlugin/shortcuts.ts";

export const BlockFormatDropdown: FC = () => {
  return (
    <div className="flex items-center">
      <Select>
        <SelectTrigger className="h-8 w-[130px] gap-1">
          <Type className="h-4 w-4" />
          <SelectValue placeholder="Format" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="<p>">Paragraph</SelectItem>
          <SelectItem value="<h1>">Heading 1 {SHORTCUTS.HEADING1}</SelectItem>
          <SelectItem value="<h2>">Heading 2</SelectItem>
          <SelectItem value="<h3>">Heading 3</SelectItem>
          <SelectItem value="<pre>">Code Block</SelectItem>
          <SelectItem value="<blockquote>">Quote</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};
