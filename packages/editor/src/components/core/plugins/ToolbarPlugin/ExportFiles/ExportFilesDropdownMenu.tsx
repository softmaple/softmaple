import { useState } from "react";
import type { FC, ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@softmaple/editor/components/ui/dropdown-menu.tsx";
import { Button } from "@softmaple/editor/components/ui/button.tsx";
import { Download, FileText } from "lucide-react";
import { $convertToMarkdownString } from "@lexical/markdown";
import { PLAYGROUND_TRANSFORMERS } from "@softmaple/editor/components/core/plugins/MarkdownTransformers/MarkdownTransformers.ts";
import { markdownToLatex } from "@softmaple/md2latex/src/md2latex";
import type { LexicalEditor } from "lexical";
import type { ExportFormat } from "./ExportFilesMenuItem";
import { ExportFilesMenuItem } from "./ExportFilesMenuItem";

const exportOptions: Array<{
  key: string;
  format: ExportFormat;
  icon: ReactNode;
  label: string;
}> = [
  {
    key: "Markdown",
    format: "markdown",
    icon: <FileText className="mr-2 h-4 w-4" />,
    label: "Markdown",
  },
  {
    key: "LaTeX",
    format: "latex",
    icon: <FileText className="mr-2 h-4 w-4" />,
    label: "LaTeX",
  },
];

type ExportFilesDropdownMenuProps = {
  editor: LexicalEditor;
};

export const ExportFilesDropdownMenu: FC<ExportFilesDropdownMenuProps> = (
  props,
) => {
  const { editor } = props;

  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  const downloadFile = (
    content: Blob | string,
    filename: string,
    mimeType?: string,
  ) => {
    // Create blob with the content if it's a string
    const blob =
      typeof content === "string"
        ? new Blob([content], { type: mimeType })
        : content;

    // Create object URL
    const url = URL.createObjectURL(blob);

    // Create temporary link element
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;

    // Append to body, click, and remove
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up object URL
    URL.revokeObjectURL(url);
  };

  const handleExport = async (format: ExportFormat) => {
    setIsDownloading(true);

    try {
      const markdownContent = editor
        .getEditorState()
        .read(() =>
          $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, undefined, true),
        );
      let latexContent: string;

      switch (format) {
        case "markdown":
          downloadFile(markdownContent, "document.md", "text/markdown");
          break;

        case "latex":
          latexContent = markdownToLatex(markdownContent);
          downloadFile(latexContent, "document.tex", "text/x-latex");
          break;

        default:
          break;
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="flex items-center gap-4 ml-auto">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {exportOptions.map(({ key, format, icon, label }) => (
            <ExportFilesMenuItem
              key={key}
              format={format}
              isDownloading={isDownloading}
              onClick={() => handleExport(format)}
              icon={icon}
              label={label}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
