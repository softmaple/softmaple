"use client";

import type { FC } from "react";
import { useState } from "react";
import { Button } from "@softmaple/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { Input } from "@softmaple/ui/components/input";
import {
  Plus,
  Search,
  FileText,
  Users,
  Clock,
  MoreHorizontal,
  FolderPlus,
} from "lucide-react";
import Link from "next/link";
import { CreateWorkspaceDialog } from "@/modules/workspaces/create-workspace-dialog";

type Workspace = any;

export type DashboardProps = {
  workspaces: Workspace[] | null;
};

export const Dashboard: FC<DashboardProps> = ({
  workspaces: initWorkspaces,
}) => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(
    initWorkspaces || [],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const filteredWorkspaces = workspaces.filter(
    (workspace) =>
      workspace.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      workspace?.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (!workspaces.length) {
    return (
      <>
        <main className="container mx-auto px-4 py-16">
          <div className="max-w-2xl mx-auto text-center">
            <div className="w-24 h-24 bg-gradient-to-br from-orange-500 to-red-500 rounded-2xl flex items-center justify-center mx-auto mb-8">
              <FolderPlus className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-3xl font-bold mb-4">Welcome to Softmaple</h1>
            <p className="text-xl text-muted-foreground mb-8">
              Create your first workspace to start writing and collaborating on
              documents.
            </p>
            <Button
              size="lg"
              onClick={() => setShowCreateDialog(true)}
              className="px-8"
            >
              <Plus className="mr-2 h-5 w-5" />
              Create Your First Workspace
            </Button>
          </div>
        </main>

        <CreateWorkspaceDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
        />
      </>
    );
  }

  return (
    <>
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Your Workspaces</h1>
            <p className="text-muted-foreground">
              Manage your documents and collaborate with your team
            </p>
          </div>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Workspace
          </Button>
        </div>

        <div className="flex items-center space-x-4 mb-8">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search workspaces..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredWorkspaces.map((workspace) => (
            <Link key={workspace.id} href={`/workspace/${workspace.slug}`}>
              <Card className="hover:shadow-lg transition-all duration-200 cursor-pointer group">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div
                      className={`w-12 h-12 bg-gradient-to-br ${workspace?.color} rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform duration-200`}
                    >
                      <FileText className="w-6 h-6 text-white" />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                  <CardTitle className="text-xl">{workspace.title}</CardTitle>
                  <CardDescription>{workspace.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center">
                        <FileText className="w-4 h-4 mr-1" />
                        {workspace?.documentsCount}
                      </div>
                      <div className="flex items-center">
                        <Users className="w-4 h-4 mr-1" />
                        {workspace?.membersCount}
                      </div>
                    </div>
                    <div className="flex items-center">
                      <Clock className="w-4 h-4 mr-1" />
                      {workspace?.lastActivity}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </main>

      <CreateWorkspaceDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        // onCreateWorkspace={handleCreateWorkspace}
      />
    </>
  );
};
