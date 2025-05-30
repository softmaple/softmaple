"use client";

import { useState, useEffect } from "react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Badge } from "@softmaple/ui/components/badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import { Separator } from "@softmaple/ui/components/separator";
import {
  Save,
  Share,
  Download,
  MoreHorizontal,
  Users,
  Clock,
  Eye,
  Edit3,
  FileText,
  Code,
} from "lucide-react";
import { useParams } from "next/navigation";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@softmaple/ui/components/tabs";
import { DocEditor } from "@/modules/docs/doc-editor";
import { Room } from "@/app/workspace/[workspaceSlug]/doc/[docSlug]/room";

export default function DocumentPage() {
  const params = useParams();
  const { workspaceSlug, docSlug } = params;

  const [title, setTitle] = useState("Research Proposal");
  const [content, setContent] = useState(`# Research Proposal

## Abstract

This research proposal outlines a comprehensive study on the applications of machine learning in academic writing tools. The study aims to investigate how AI-powered suggestions can enhance the writing process for researchers and academics.

## Introduction

The landscape of academic writing has evolved significantly with the advent of digital tools. Traditional word processors have given way to more sophisticated platforms that offer real-time collaboration, version control, and intelligent assistance.

### Research Questions

1. How can machine learning improve the quality of academic writing?
2. What are the most effective AI-powered features for researchers?
3. How does collaborative editing impact research productivity?

## Methodology

Our research will employ a mixed-methods approach, combining quantitative analysis of writing metrics with qualitative interviews of academic users.

### Data Collection

- **Quantitative**: Writing speed, error rates, revision frequency
- **Qualitative**: User interviews, focus groups, usability testing

## Expected Outcomes

We anticipate that this research will provide valuable insights into the future of academic writing tools and inform the development of next-generation platforms.`);

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

  const handleSave = () => {
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
    <div className="flex-1 flex flex-col">
      {/* Document Header */}
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-4 flex-1">
              <Input
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
                    <AvatarImage
                      src={collaborator.avatar || "/placeholder.svg"}
                    />
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

      {/* Document Content */}
      <main className="flex-1 overflow-hidden">
        <Tabs defaultValue="editor" className="h-full flex flex-col">
          <TabsList className="mx-6 mt-4 w-fit">
            <TabsTrigger value="editor">
              <Edit3 className="mr-2 h-4 w-4" />
              Editor
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye className="mr-2 h-4 w-4" />
              Preview
            </TabsTrigger>
            <TabsTrigger value="latex">
              <Code className="mr-2 h-4 w-4" />
              LaTeX
            </TabsTrigger>
            <TabsTrigger value="markdown">
              <FileText className="mr-2 h-4 w-4" />
              Markdown
            </TabsTrigger>
          </TabsList>

          <TabsContent value="editor" className="flex-1 m-0">
            <Room>
              <DocEditor />
            </Room>
          </TabsContent>

          <TabsContent value="preview" className="flex-1 m-0">
            <div className="h-full p-6 overflow-auto">
              <div className="max-w-4xl mx-auto prose prose-slate dark:prose-invert">
                <div
                  dangerouslySetInnerHTML={{
                    __html: content.replace(/\n/g, "<br>"),
                  }}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="latex" className="flex-1 m-0">
            <div className="h-full p-6">
              <pre className="w-full h-full overflow-auto bg-muted/30 p-4 rounded-lg font-mono text-sm">
                {`\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\title{${title}}
\\author{Research Team}
\\date{\\today}

\\begin{document}
\\maketitle

${content.replace(/# /g, "\\section{").replace(/\n/g, "}\n")}

\\end{document}`}
              </pre>
            </div>
          </TabsContent>

          <TabsContent value="markdown" className="flex-1 m-0">
            <div className="h-full p-6">
              <pre className="w-full h-full overflow-auto bg-muted/30 p-4 rounded-lg font-mono text-sm">
                {content}
              </pre>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
