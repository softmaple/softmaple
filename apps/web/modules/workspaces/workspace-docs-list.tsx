"use client";

import type { FC } from "react";
import { useState } from "react";
import { Button } from "@softmaple/ui/components/button";
import { FileText, Folder, Plus } from "lucide-react";
import { ScrollArea } from "@softmaple/ui/components/scroll-area";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DocsType } from "@/types/model";

export type WorkspaceDocsListProps = {
  workspaceSlug: string;
};

export const WorkspaceDocsList: FC<WorkspaceDocsListProps> = (props) => {
  const { workspaceSlug } = props;

  const pathname = usePathname();
  // FIXME: docs and folders
  const [documents] = useState<Array<DocsType["Row"] & any>>([
    {
      id: "1",
      title: "Research Proposal",
      type: "document",
      lastModified: "2 hours ago",
    },
    {
      id: "2",
      title: "Literature Review",
      type: "document",
      lastModified: "1 day ago",
    },
    {
      id: "3",
      title: "Methodology",
      type: "document",
      lastModified: "3 days ago",
    },
    {
      id: "4",
      title: "References",
      type: "folder",
      lastModified: "1 week ago",
    },
  ]);

  const isActive = (path: string) => pathname === path;

  return (
    <div className="flex-1 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium">Documents</h3>
        <Button size="sm" variant="ghost">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="h-full">
        <div className="space-y-1">
          {documents.map((doc) => (
            <Link
              key={doc.id}
              href={`/workspace/${workspaceSlug}/doc/${doc.id}`}
            >
              <Button
                variant={
                  isActive(`/workspace/${workspaceSlug}/doc/${doc.id}`)
                    ? "secondary"
                    : "ghost"
                }
                className="w-full justify-start text-left"
              >
                {doc.type === "folder" ? (
                  <Folder className="mr-2 h-4 w-4" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                <div className="flex-1 truncate">
                  <div className="truncate">{doc.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {doc.lastModified}
                  </div>
                </div>
              </Button>
            </Link>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
