"use client";

import type { FC } from "react";
import { useState } from "react";
import { Code, Edit3, Eye, FileText } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@softmaple/ui/components/tabs";
import { Room } from "@/modules/docs/room";
import { DocEditor } from "@/modules/docs/doc-editor";
import { DocHeader } from "@/modules/docs/doc-header";

export type DocumentEditorProps = {
  title: string;
  content: string;
  // TODO: title kebab case slug + timestamp
  docSlug?: string;
  isPublic?: boolean;
};

export const DocumentEditor: FC<DocumentEditorProps> = (props) => {
  const {
    title: initialTitle,
    content: initialContent,
    docSlug,
    isPublic = false,
  } = props;

  const [title, setTitle] = useState<string>(initialTitle);
  const [content, setContent] = useState<string>(initialContent);

  return (
    <div className="flex-1 flex flex-col">
      {/* Document Header */}
      <DocHeader
        title={title}
        setTitle={setTitle}
        content={content}
        setContent={setContent}
      />

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
            {docSlug && isPublic ? (
              <Room roomId={docSlug}>
                <DocEditor isPublic />
              </Room>
            ) : (
              <DocEditor />
            )}
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
};
