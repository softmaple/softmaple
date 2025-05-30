"use client";

import { useState } from "react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import { Textarea } from "@softmaple/ui/components/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { Switch } from "@softmaple/ui/components/switch";
import { Badge } from "@softmaple/ui/components/badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@softmaple/ui/components/tabs";
import {
  Settings,
  Users,
  Shield,
  Trash2,
  Plus,
  Crown,
  Edit,
  UserX,
} from "lucide-react";
import { useParams } from "next/navigation";

export default function WorkspaceSettingsPage() {
  const params = useParams();
  const workspaceId = params.workspaceId as string;

  const [workspaceName, setWorkspaceName] = useState("Research Papers");
  const [workspaceDescription, setWorkspaceDescription] = useState(
    "Academic research and publications",
  );
  const [isPublic, setIsPublic] = useState(false);
  const [allowComments, setAllowComments] = useState(true);
  const [autoSave, setAutoSave] = useState(true);

  const members = [
    {
      id: "1",
      name: "John Doe",
      email: "john@example.com",
      role: "Owner",
      avatar: "/placeholder.svg?height=32&width=32",
      joinedAt: "2 months ago",
    },
    {
      id: "2",
      name: "Jane Smith",
      email: "jane@example.com",
      role: "DocEditor",
      avatar: "/placeholder.svg?height=32&width=32",
      joinedAt: "1 month ago",
    },
    {
      id: "3",
      name: "Bob Johnson",
      email: "bob@example.com",
      role: "Viewer",
      avatar: "/placeholder.svg?height=32&width=32",
      joinedAt: "2 weeks ago",
    },
  ];

  const handleSaveSettings = () => {
    // Simulate save
    console.log("Settings saved");
  };

  const handleInviteMember = () => {
    // Handle member invitation
    console.log("Invite member");
  };

  const handleRemoveMember = (memberId: string) => {
    // Handle member removal
    console.log("Remove member:", memberId);
  };

  const handleChangeRole = (memberId: string, newRole: string) => {
    // Handle role change
    console.log("Change role:", memberId, newRole);
  };

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-6 py-4">
          <div className="flex items-center space-x-2">
            <Settings className="h-5 w-5" />
            <h1 className="text-2xl font-bold">Workspace Settings</h1>
          </div>
          <p className="text-muted-foreground">
            Manage your workspace preferences and team
          </p>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6">
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList>
            <TabsTrigger value="general">
              <Settings className="mr-2 h-4 w-4" />
              General
            </TabsTrigger>
            <TabsTrigger value="members">
              <Users className="mr-2 h-4 w-4" />
              Members
            </TabsTrigger>
            <TabsTrigger value="permissions">
              <Shield className="mr-2 h-4 w-4" />
              Permissions
            </TabsTrigger>
            <TabsTrigger value="danger">
              <Trash2 className="mr-2 h-4 w-4" />
              Danger Zone
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Workspace Information</CardTitle>
                <CardDescription>
                  Update your workspace name and description
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="workspace-name">Workspace Name</Label>
                  <Input
                    id="workspace-name"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="workspace-description">Description</Label>
                  <Textarea
                    id="workspace-description"
                    value={workspaceDescription}
                    onChange={(e) => setWorkspaceDescription(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button onClick={handleSaveSettings}>Save Changes</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Workspace Preferences</CardTitle>
                <CardDescription>
                  Configure how your workspace behaves
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Public Workspace</Label>
                    <p className="text-sm text-muted-foreground">
                      Allow anyone with the link to view documents
                    </p>
                  </div>
                  <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Allow Comments</Label>
                    <p className="text-sm text-muted-foreground">
                      Enable commenting on documents
                    </p>
                  </div>
                  <Switch
                    checked={allowComments}
                    onCheckedChange={setAllowComments}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Auto-save</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically save changes every 30 seconds
                    </p>
                  </div>
                  <Switch checked={autoSave} onCheckedChange={setAutoSave} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="members" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Team Members</CardTitle>
                    <CardDescription>
                      Manage who has access to this workspace
                    </CardDescription>
                  </div>
                  <Button onClick={handleInviteMember}>
                    <Plus className="mr-2 h-4 w-4" />
                    Invite Member
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center space-x-3">
                        <Avatar>
                          <AvatarImage
                            src={member.avatar || "/placeholder.svg"}
                          />
                          <AvatarFallback>
                            {member.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="flex items-center space-x-2">
                            <p className="font-medium">{member.name}</p>
                            {member.role === "Owner" && (
                              <Crown className="h-4 w-4 text-yellow-500" />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {member.email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Joined {member.joinedAt}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge
                          variant={
                            member.role === "Owner" ? "default" : "secondary"
                          }
                        >
                          {member.role}
                        </Badge>
                        {member.role !== "Owner" && (
                          <>
                            <Button variant="ghost" size="icon">
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleRemoveMember(member.id)}
                            >
                              <UserX className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="permissions" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Access Permissions</CardTitle>
                <CardDescription>
                  Control what different roles can do in this workspace
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium mb-2">Owner</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Full access to all workspace features</li>
                      <li>• Can manage members and permissions</li>
                      <li>• Can delete the workspace</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Editor</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Can create, edit, and delete documents</li>
                      <li>• Can invite new members</li>
                      <li>• Can comment on documents</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium mb-2">Viewer</h4>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>• Can view documents</li>
                      <li>• Can comment on documents</li>
                      <li>• Cannot edit or create documents</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="danger" className="space-y-6">
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle className="text-destructive">Danger Zone</CardTitle>
                <CardDescription>
                  Irreversible and destructive actions
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between p-4 border border-destructive rounded-lg">
                  <div>
                    <h4 className="font-medium">Delete Workspace</h4>
                    <p className="text-sm text-muted-foreground">
                      Permanently delete this workspace and all its documents
                    </p>
                  </div>
                  <Button variant="destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete Workspace
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
