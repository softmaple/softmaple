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
import { createDoc } from "@/modules/docs/utils/create-doc";
import kebabCase from "lodash/kebabCase";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useEditorState } from "@/contexts/EditorStateContext";
import { ExportFilesDropdownMenu } from "@softmaple/editor/components/core/ExportFiles/ExportFilesDropdownMenu";

export type DocHeaderProps = {
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  content: string;
  setContent: Dispatch<SetStateAction<string>>;
  isNewDoc: boolean;
  workspaceId: number;
  userId: string;
  docSlug?: string;
};

export const DocHeader: FC<DocHeaderProps> = (props) => {
  const {
    title,
    setTitle,
    content,
    setContent,
    isNewDoc,
    userId,
    workspaceId,
    docSlug,
  } = props;

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const { activeEditor } = useEditorState();

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
    try {
      if (!isNewDoc) return;

      const newDoc = {
        title,
        slug: kebabCase(`${title}-${Date.now()}`),
        workspace_id: workspaceId,
        author_id: userId,
        // FIXME: retrieve the content from the editor
        markdown_content: "",
      };
      const { data: createdDoc, error } = await createDoc(newDoc);

      if (error) {
        console.error("Error creating document:", error);
        throw error;
      }

      // update the page slug in the URL if it's a new document
      if (createdDoc) {
        const newSlug = createdDoc.slug;
        // Update the URL to reflect the new document slug
        const urlParams = new URLSearchParams(searchParams.toString());

        // replace the "new" slug in the end with the new document slug
        const pathnameParts = pathname.split("/");
        pathnameParts[pathnameParts.length - 1] = newSlug;
        const newPathname = pathnameParts.join("/");
        // Update the URL with the new slug
        router.push(`${newPathname}?${urlParams.toString()}`, { scroll: true });
      }

      setLastSaved("Just now");
    } catch (error) {
      console.error("Error saving document:", error);
    } finally {
      //
    }
  };

  useEffect(() => {
    if (isNewDoc) return;

    const interval = setInterval(() => {
      handleSave();
    }, 30000);

    return () => clearInterval(interval);
  }, [isNewDoc]);

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
            <ExportFilesDropdownMenu
              dropdownMenuTrigger={
                <Button variant="ghost" size="sm">
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
              }
              editor={activeEditor}
            />
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
