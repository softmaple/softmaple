"use client";

import type { FC } from "react";
import { useMemo, useState } from "react";
import { Code, Edit3, Eye, FileText } from "lucide-react";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@softmaple/ui/components/tabs";
import { DocEditor } from "@/modules/docs/doc-editor";
import { DocHeader } from "@/modules/docs/doc-header";
import type { DocHeaderProps } from "@/modules/docs/doc-header";
import { sanitizeHtml } from "@/modules/docs/sanitize-html";
import { useEditorState } from "@/contexts/EditorStateContext";

export type DocumentEditorProps = Omit<
  DocHeaderProps,
  "setTitle" | "setContent"
> & {
  documentId: string;
};

/**
 * Preview / Markdown / LaTeX tabs derive from the current editor HTML when
 * available. We no longer treat `markdown_content` as collaboration truth.
 */
export const DocumentEditor: FC<DocumentEditorProps> = (props) => {
  const {
    title: initialTitle,
    content: initialContent,
    docSlug,
    workspaceId,
    userId,
    isNewDoc,
    documentId,
  } = props;

  const [title, setTitle] = useState<string>(initialTitle);
  const [content, setContent] = useState<string>(initialContent);
  const { activeEditor } = useEditorState();

  const liveHtml = useMemo(() => {
    if (!activeEditor) return content;
    return activeEditor.getRootElement()?.innerHTML ?? content;
  }, [activeEditor, content]);

  const sanitizedPreview = useMemo(() => sanitizeHtml(liveHtml), [liveHtml]);

  return (
    <div className="flex-1 flex flex-col">
      <DocHeader
        title={title}
        setTitle={setTitle}
        content={content}
        setContent={setContent}
        isNewDoc={isNewDoc}
        workspaceId={workspaceId}
        userId={userId}
        docSlug={docSlug}
      />

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
            <DocEditor documentId={documentId} enableCollab />
          </TabsContent>

          <TabsContent value="preview" className="flex-1 m-0">
            <div className="h-full p-6 overflow-auto">
              <div className="max-w-4xl mx-auto prose prose-slate dark:prose-invert">
                <div
                  dangerouslySetInnerHTML={{
                    __html: sanitizedPreview,
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

% Generated on demand from the live editor — not from stored markdown_content.

\\end{document}`}
              </pre>
            </div>
          </TabsContent>

          <TabsContent value="markdown" className="flex-1 m-0">
            <div className="h-full p-6">
              <pre className="w-full h-full overflow-auto bg-muted/30 p-4 rounded-lg font-mono text-sm">
                {
                  "Markdown is generated on demand from the live editor state.\nCollaboration persists EG-walker event batches in Supabase Postgres."
                }
              </pre>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};
