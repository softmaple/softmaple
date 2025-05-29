"use client";

import { useState, useEffect } from "react";
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
import { useRouter } from "next/navigation";
import { CreateWorkspaceDialog } from "@/modules/workspaces/create-workspace-dialog";

interface Workspace {
  id: string;
  name: string;
  description: string;
  documentsCount: number;
  membersCount: number;
  lastActivity: string;
  color: string;
}

export default function DashboardPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Simulate loading workspaces
    const mockWorkspaces: Workspace[] = [
      {
        id: "1",
        name: "Research Papers",
        description: "Academic research and publications",
        documentsCount: 12,
        membersCount: 3,
        lastActivity: "2 hours ago",
        color: "from-blue-500 to-cyan-500",
      },
      {
        id: "2",
        name: "Technical Documentation",
        description: "API docs and technical guides",
        documentsCount: 8,
        membersCount: 5,
        lastActivity: "1 day ago",
        color: "from-green-500 to-emerald-500",
      },
    ];
    setWorkspaces(mockWorkspaces);
  }, []);

  const filteredWorkspaces = workspaces.filter(
    (workspace) =>
      workspace.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      workspace.description.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleCreateWorkspace = (workspace: {
    name: string;
    description: string;
  }) => {
    const newWorkspace: Workspace = {
      id: Date.now().toString(),
      name: workspace.name,
      description: workspace.description,
      documentsCount: 0,
      membersCount: 1,
      lastActivity: "Just now",
      color: "from-purple-500 to-pink-500",
    };
    setWorkspaces((prev) => [...prev, newWorkspace]);
    setShowCreateDialog(false);
    router.push(`/workspace/${newWorkspace.id}`);
  };

  if (!workspaces.length) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-xl">Softmaple</span>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="ghost" size="sm">
                Settings
              </Button>
              <Button variant="ghost" size="sm">
                Profile
              </Button>
            </div>
          </div>
        </header>

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
          onCreateWorkspace={handleCreateWorkspace}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-xl">Softmaple</span>
          </div>
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="sm">
              Settings
            </Button>
            <Button variant="ghost" size="sm">
              <Link href="/settings/account">Profile</Link>
            </Button>
          </div>
        </div>
      </header>

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
            <Link key={workspace.id} href={`/workspace/${workspace.id}`}>
              <Card className="hover:shadow-lg transition-all duration-200 cursor-pointer group">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div
                      className={`w-12 h-12 bg-gradient-to-br ${workspace.color} rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform duration-200`}
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
                  <CardTitle className="text-xl">{workspace.name}</CardTitle>
                  <CardDescription>{workspace.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center space-x-4">
                      <div className="flex items-center">
                        <FileText className="w-4 h-4 mr-1" />
                        {workspace.documentsCount}
                      </div>
                      <div className="flex items-center">
                        <Users className="w-4 h-4 mr-1" />
                        {workspace.membersCount}
                      </div>
                    </div>
                    <div className="flex items-center">
                      <Clock className="w-4 h-4 mr-1" />
                      {workspace.lastActivity}
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
        onCreateWorkspace={handleCreateWorkspace}
      />
    </div>
  );
}
