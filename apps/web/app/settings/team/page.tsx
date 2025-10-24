"use client";

import { useState } from "react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { Badge } from "@softmaple/ui/components/badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import {
  Users,
  Plus,
  Search,
  Crown,
  Edit,
  UserX,
  Mail,
  Settings,
} from "lucide-react";
import Link from "next/link";

export default function TeamSettingsPage() {
  const [searchQuery, setSearchQuery] = useState("");

  const teamMembers = [
    {
      id: "1",
      name: "John Doe",
      email: "john@example.com",
      role: "Owner",
      avatar: "/placeholder.svg?height=40&width=40",
      joinedAt: "2 months ago",
      lastActive: "2 hours ago",
    },
    {
      id: "2",
      name: "Jane Smith",
      email: "jane@example.com",
      role: "Admin",
      avatar: "/placeholder.svg?height=40&width=40",
      joinedAt: "1 month ago",
      lastActive: "1 day ago",
    },
    {
      id: "3",
      name: "Bob Johnson",
      email: "bob@example.com",
      role: "Member",
      avatar: "/placeholder.svg?height=40&width=40",
      joinedAt: "2 weeks ago",
      lastActive: "3 days ago",
    },
  ];

  const filteredMembers = teamMembers.filter(
    (member) =>
      member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.email.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link href="/dashboard" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
                <Settings className="w-5 h-5 text-white" />
              </div>
              <span className="font-semibold text-xl">Team Management</span>
            </Link>
          </div>
          <Link href="/dashboard">
            <Button variant="ghost">Back to Dashboard</Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="space-y-8">
          {/* Team Overview */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center">
                    <Users className="mr-2 h-5 w-5" />
                    Team Members
                  </CardTitle>
                  <CardDescription>
                    Manage your team members and their permissions
                  </CardDescription>
                </div>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Invite Member
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center space-x-4 mb-6">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                  <Input
                    placeholder="Search team members..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="space-y-4">
                {filteredMembers.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center space-x-4">
                      <Avatar className="w-12 h-12">
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
                          <h4 className="font-medium">{member.name}</h4>
                          {member.role === "Owner" && (
                            <Crown className="h-4 w-4 text-yellow-500" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {member.email}
                        </p>
                        <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                          <span>Joined {member.joinedAt}</span>
                          <span>•</span>
                          <span>Active {member.lastActive}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-3">
                      <Badge
                        variant={
                          member.role === "Owner" ? "default" : "secondary"
                        }
                      >
                        {member.role}
                      </Badge>
                      {member.role !== "Owner" && (
                        <div className="flex items-center space-x-1">
                          <Button variant="ghost" size="icon">
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon">
                            <Mail className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon">
                            <UserX className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Role Permissions */}
          <Card>
            <CardHeader>
              <CardTitle>Role Permissions</CardTitle>
              <CardDescription>
                Understand what each role can do in your organization
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Crown className="h-5 w-5 text-yellow-500" />
                    <h4 className="font-medium">Owner</h4>
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Full access to all features</li>
                    <li>• Manage billing and subscription</li>
                    <li>• Add/remove team members</li>
                    <li>• Delete organization</li>
                  </ul>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Users className="h-5 w-5 text-blue-500" />
                    <h4 className="font-medium">Admin</h4>
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Manage team members</li>
                    <li>• Create and manage workspaces</li>
                    <li>• Access all documents</li>
                    <li>• Configure integrations</li>
                  </ul>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Users className="h-5 w-5 text-green-500" />
                    <h4 className="font-medium">Member</h4>
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Create and edit documents</li>
                    <li>• Join assigned workspaces</li>
                    <li>• Collaborate with team</li>
                    <li>• Export documents</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
