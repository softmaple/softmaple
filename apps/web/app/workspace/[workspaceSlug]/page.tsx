import { Button } from "@softmaple/ui/components/button";
import {
  Card,
  CardContent,
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
  FileText,
  Plus,
  Users,
  Clock,
  TrendingUp,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";

import type { Metadata, ResolvingMetadata } from "next";
import { cachedGetWorkspaceBySlug } from "@/app/actions/workspaces";
import { getAll } from "@/app/actions/getAll";

type Props = {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata(
  { params, searchParams }: Props,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { workspaceSlug } = await params;

  // fetch workspace information
  const { data: workspace } = await cachedGetWorkspaceBySlug(workspaceSlug);

  const { title, description } = workspace || {};

  return {
    title,
    description,
  };
}

export default async function WorkspacePage({ params, searchParams }: Props) {
  const { workspaceSlug } = await params;

  // FIXME: only query data for the current workspace
  const [{ data: documents, error: err1 }, { data: members, error: err2 }] =
    await Promise.all([
      getAll("documents", undefined, 5),
      getAll("workspace_members", undefined, undefined, "users"),
    ]);

  const recentDocuments = (documents || []).map((doc) => ({
    ...doc,
    key: doc.id,
  }));
  const allWorkspaceMembers = (members || []).map((member) => ({
    ...member,
    user: member?.users,
    key: member.id,
  }));

  const error = err1 || err2;

  if (error) {
    console.error(error);

    throw error;
  }

  const recentActivity = [
    { action: "John Doe edited Research Proposal", time: "2 hours ago" },
    {
      action: "Jane Smith commented on Literature Review",
      time: "4 hours ago",
    },
    { action: "John Doe created Methodology", time: "3 days ago" },
    { action: "Jane Smith joined the workspace", time: "1 week ago" },
  ];

  return (
    <div className="flex-1 overflow-auto">
      {/* Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Research Papers</h1>
              <p className="text-muted-foreground">
                Academic research and publications
              </p>
            </div>
            <div className="flex items-center space-x-2">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                <Link href={`/workspace/${workspaceSlug}/doc/new`}>
                  New Document
                </Link>
              </Button>
              <Button variant="outline">
                <Users className="mr-2 h-4 w-4" />
                Invite
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Total Documents
              </CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {recentDocuments?.length || 0}
              </div>
              <p className="text-xs text-muted-foreground">+2 from last week</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Team Members
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{members?.length || 0}</div>
              <p className="text-xs text-muted-foreground">All active</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">This Week</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">8</div>
              <p className="text-xs text-muted-foreground">Documents edited</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Last Activity
              </CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">2h</div>
              <p className="text-xs text-muted-foreground">ago</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Documents */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Recent Documents</CardTitle>

                {recentDocuments.length ? (
                  <Button variant="ghost" size="sm">
                    View all
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {recentDocuments.map((doc: any) => (
                <Link
                  key={doc.id}
                  href={`/workspace/${workspaceSlug}/doc/${doc.slug}`}
                >
                  <div className="flex items-center space-x-4 p-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-lg flex items-center justify-center">
                      <FileText className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium">{doc.title}</h4>
                      <p className="text-sm text-muted-foreground">
                        Edited by {doc.created_by} • {doc.updated_at}
                      </p>
                    </div>
                    <Button variant="ghost" size="icon">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {recentActivity.map((activity, index) => (
                <div key={index} className="flex items-start space-x-3">
                  <div className="w-2 h-2 bg-primary rounded-full mt-2"></div>
                  <div className="flex-1">
                    <p className="text-sm">{activity.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {activity.time}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Team Members */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Team Members</CardTitle>
              <Button variant="outline" size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Invite Member
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(allWorkspaceMembers || []).map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center space-x-3">
                    <Avatar>
                      <AvatarImage
                        src={member?.user?.avatar_src || "/placeholder.svg"}
                      />
                      <AvatarFallback>
                        {member?.user?.full_name
                          .split(" ")
                          .map((n: string) => n[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium">{member?.user?.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {member?.user?.email}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary">{member.role}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
