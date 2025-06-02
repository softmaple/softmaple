"use client";

import type { FC, Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Input } from "@softmaple/ui/components/input";
import { Badge } from "@softmaple/ui/components/badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import { Button } from "@softmaple/ui/components/button";
import {
  Clock,
  Download,
  Edit3,
  Eye,
  MoreHorizontal,
  Save,
  Share,
  Users,
} from "lucide-react";
import { Separator } from "@softmaple/ui/components/separator";

export type DocHeaderProps = {
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  content: string;
  setContent: Dispatch<SetStateAction<string>>;
};

export const DocHeader: FC<DocHeaderProps> = (props) => {
  const { title, setTitle, content, setContent } = props;

  const [isEditing, setIsEditing] = useState(true);
  const [lastSaved, setLastSaved] = useState("2 minutes ago");

  const collaborators = [
    {
      name: "John Doe",
      avatar: "/placeholder.svg?height=32&width=32",
      status: "online",
    },
    {
      name: "Jane Smith",
      avatar: "/placeholder.svg?height=32&width=32",
      status: "away",
    },
  ];

  const handleSave = async () => {
    // Simulate save
    setLastSaved("Just now");
  };

  useEffect(() => {
    // Auto-save simulation
    const interval = setInterval(() => {
      handleSave();
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  return (
    <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-4 flex-1">
            <Input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="text-xl font-semibold border-none bg-transparent p-0 h-auto focus-visible:ring-0"
            />
            <Badge variant="secondary">Draft</Badge>
          </div>

          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1">
              {collaborators.map((collaborator, index) => (
                <Avatar
                  key={index}
                  className="w-8 h-8 border-2 border-background"
                >
                  <AvatarImage src={collaborator.avatar} />
                  <AvatarFallback className="text-xs">
                    {collaborator.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </AvatarFallback>
                </Avatar>
              ))}
              <Button variant="ghost" size="icon" className="w-8 h-8">
                <Users className="h-4 w-4" />
              </Button>
            </div>

            <Separator orientation="vertical" className="h-6" />

            <Button variant="ghost" size="sm">
              <Share className="mr-2 h-4 w-4" />
              Share
            </Button>
            <Button variant="ghost" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button size="sm" onClick={handleSave}>
              <Save className="mr-2 h-4 w-4" />
              Save
            </Button>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center space-x-4">
            <div className="flex items-center">
              <Clock className="mr-1 h-4 w-4" />
              Last saved {lastSaved}
            </div>
            <div className="flex items-center">
              <Users className="mr-1 h-4 w-4" />2 collaborators
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              variant={isEditing ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setIsEditing(true)}
            >
              <Edit3 className="mr-2 h-4 w-4" />
              Edit
            </Button>
            <Button
              variant={!isEditing ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setIsEditing(false)}
            >
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};
