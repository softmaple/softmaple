import { useState } from "react";
import type { FC } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Download, FileText, FolderArchive } from "lucide-react";
import { $convertToMarkdownString } from "@lexical/markdown";
import { PLAYGROUND_TRANSFORMERS } from "@/components/core/plugins/MarkdownTransformers/MarkdownTransformers.ts";
import { markdownToLatex } from "@softmaple/md2latex/src/md2latex";
import type { LexicalEditor } from "lexical";
// import JSZip from "jszip";

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

  const handleExport = async (format: "markdown" | "latex" | "zip") => {
    setIsDownloading(true);

    try {
      const markdownContent = editor
        .getEditorState()
        .read(() =>
          $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, undefined, true),
        );

      switch (format) {
        case "markdown":
          downloadFile(markdownContent, "document.md", "text/markdown");
          break;

        case "latex":
          const latexContent = markdownToLatex(markdownContent);
          downloadFile(latexContent, "document.tex", "text/x-latex");
          break;

        case "zip":
          // const zip = new JSZip();
          // zip.file("document.md", markdownContent);
          // zip.file("document.tex", markdownToLatex(markdownContent));

          // const zipBlob = await zip.generateAsync({ type: "blob" });
          // downloadFile(zipBlob, "documents.zip");
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
          <DropdownMenuItem
            disabled={isDownloading}
            onClick={() => handleExport("markdown")}
          >
            <FileText className="mr-2 h-4 w-4" />
            Markdown
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={isDownloading}
            onClick={() => handleExport("latex")}
          >
            <FileText className="mr-2 h-4 w-4" />
            LaTeX
          </DropdownMenuItem>
          <DropdownMenuItem disabled onClick={() => handleExport("zip")}>
            <FolderArchive className="mr-2 h-4 w-4" />
            ZIP
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
