"use client";

import type { FC, ReactNode } from "react";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import { Button } from "@softmaple/ui/components/button";
import {
  FileText,
  Folder,
  Home,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Input } from "@softmaple/ui/components/input";
import { Separator } from "@softmaple/ui/components/separator";
import { ScrollArea } from "@softmaple/ui/components/scroll-area";
import { usePathname } from "next/navigation";

import { DocsType } from "@/types/model";

export type WorkspaceMobileSidebarProps = {
  workspaceSlug: string;
  children?: ReactNode;
};

export const WorkspaceMobileSidebar: FC<WorkspaceMobileSidebarProps> = (
  props,
) => {
  const { workspaceSlug, children } = props;

  const pathname = usePathname();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
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
    <div className="md:hidden fixed top-4 left-4 z-50">
      <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="icon">
            <Menu className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-80 p-0">
          <div className="flex flex-col h-full">
            {/* Workspace Header */}
            <div className="p-4 border-b border-border/40">
              <div className="flex items-center justify-between mb-4">
                <Link href="/dashboard" className="flex items-center space-x-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <span className="font-semibold">Softmaple</span>
                </Link>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </div>

              {children}

              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  id="search-documents"
                  placeholder="Search documents..."
                  className="pl-10"
                />
              </div>
            </div>

            {/* Navigation */}
            <div className="p-4 space-y-2">
              <Link
                href={`/workspace/${workspaceSlug}`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <Button
                  variant={
                    isActive(`/workspace/${workspaceSlug}`)
                      ? "secondary"
                      : "ghost"
                  }
                  className="w-full justify-start"
                >
                  <Home className="mr-2 h-4 w-4" />
                  Overview
                </Button>
              </Link>
              <Button
                variant="ghost"
                className="w-full justify-start"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <Users className="mr-2 h-4 w-4" />
                Members
              </Button>
              <Link
                href={`/workspace/${workspaceSlug}/settings`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                <Button
                  variant={
                    isActive(`/workspace/${workspaceSlug}/settings`)
                      ? "secondary"
                      : "ghost"
                  }
                  className="w-full justify-start"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Button>
              </Link>
            </div>

            <Separator />

            {/* Documents */}
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
                      onClick={() => setIsMobileMenuOpen(false)}
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
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};
