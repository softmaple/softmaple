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

export const ExportFilesDropdownMenu: FC = () => {
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  const handleExport = (format: "markdown" | "latex" | "zip") => {
    setIsDownloading(true);
    try {
      switch (format) {
        case "markdown":
          // TODO: Implement markdown export
          break;

        case "latex":
          // TODO: Implement LaTeX export
          break;

        case "zip":
          // TODO: Implement ZIP export
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
          <DropdownMenuItem
            disabled={isDownloading}
            onClick={() => handleExport("zip")}
          >
            <FolderArchive className="mr-2 h-4 w-4" />
            ZIP
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
