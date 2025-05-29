"use client";

import type React from "react";

import { useState } from "react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { ScrollArea } from "@softmaple/ui/components/scroll-area";
import { Separator } from "@softmaple/ui/components/separator";
import {
  FileText,
  Plus,
  Search,
  Settings,
  Users,
  Home,
  MoreHorizontal,
  ChevronDown,
  Folder,
  Menu,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Suspense } from "react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@softmaple/ui/components/dropdown-menu";

interface Document {
  id: string;
  title: string;
  type: "document" | "folder";
  lastModified: string;
}

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams();
  const pathname = usePathname();
  const workspaceId = params.workspaceId as string;

  const [documents] = useState<Document[]>([
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

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const isActive = (path: string) => pathname === path;

  return (
    <div className="h-screen flex bg-background">
      {/* Mobile Menu Trigger */}
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
                  <Link
                    href="/dashboard"
                    className="flex items-center space-x-2"
                  >
                    <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-white" />
                    </div>
                    <span className="font-semibold">Softmaple</span>
                  </Link>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="flex items-center space-x-2 mb-4 w-full justify-start p-2 h-auto"
                    >
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                        <FileText className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 text-left">
                        <h2 className="font-semibold">Research Papers</h2>
                        <p className="text-sm text-muted-foreground">
                          Academic workspace
                        </p>
                      </div>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-64" align="start">
                    <DropdownMenuLabel>Switch Workspace</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                          <FileText className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <div className="font-medium">Research Papers</div>
                          <div className="text-xs text-muted-foreground">
                            Current workspace
                          </div>
                        </div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <div className="flex items-center space-x-2">
                        <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
                          <FileText className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <div className="font-medium">
                            Technical Documentation
                          </div>
                          <div className="text-xs text-muted-foreground">
                            API docs and guides
                          </div>
                        </div>
                      </div>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem>
                      <Plus className="mr-2 h-4 w-4" />
                      Create New Workspace
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Settings className="mr-2 h-4 w-4" />
                      Manage Workspaces
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input placeholder="Search documents..." className="pl-10" />
                </div>
              </div>

              {/* Navigation */}
              <div className="p-4 space-y-2">
                <Link
                  href={`/workspace/${workspaceId}`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <Button
                    variant={
                      isActive(`/workspace/${workspaceId}`)
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
                  href={`/workspace/${workspaceId}/settings`}
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <Button
                    variant={
                      isActive(`/workspace/${workspaceId}/settings`)
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
                        href={`/workspace/${workspaceId}/doc/${doc.id}`}
                        onClick={() => setIsMobileMenuOpen(false)}
                      >
                        <Button
                          variant={
                            isActive(`/workspace/${workspaceId}/doc/${doc.id}`)
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

      {/* Desktop Sidebar */}
      <div className="hidden md:flex w-80 border-r border-border/40 bg-muted/30 flex-col">
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="flex items-center space-x-2 mb-4 w-full justify-start p-2 h-auto"
              >
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                  <FileText className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 text-left">
                  <h2 className="font-semibold">Research Papers</h2>
                  <p className="text-sm text-muted-foreground">
                    Academic workspace
                  </p>
                </div>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64" align="start">
              <DropdownMenuLabel>Switch Workspace</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                    <FileText className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <div className="font-medium">Research Papers</div>
                    <div className="text-xs text-muted-foreground">
                      Current workspace
                    </div>
                  </div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
                    <FileText className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <div className="font-medium">Technical Documentation</div>
                    <div className="text-xs text-muted-foreground">
                      API docs and guides
                    </div>
                  </div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <Plus className="mr-2 h-4 w-4" />
                Create New Workspace
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                Manage Workspaces
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input placeholder="Search documents..." className="pl-10" />
          </div>
        </div>

        {/* Navigation */}
        <div className="p-4 space-y-2">
          <Link href={`/workspace/${workspaceId}`}>
            <Button
              variant={
                isActive(`/workspace/${workspaceId}`) ? "secondary" : "ghost"
              }
              className="w-full justify-start"
            >
              <Home className="mr-2 h-4 w-4" />
              Overview
            </Button>
          </Link>
          <Button variant="ghost" className="w-full justify-start">
            <Users className="mr-2 h-4 w-4" />
            Members
          </Button>
          <Link href={`/workspace/${workspaceId}/settings`}>
            <Button
              variant={
                isActive(`/workspace/${workspaceId}/settings`)
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
                  href={`/workspace/${workspaceId}/doc/${doc.id}`}
                >
                  <Button
                    variant={
                      isActive(`/workspace/${workspaceId}/doc/${doc.id}`)
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

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        <Suspense>{children}</Suspense>
      </div>
    </div>
  );
}
