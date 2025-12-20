import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@softmaple/ui/components/card";
import { Textarea } from "@softmaple/ui/components/textarea";

function TwoPanelEditor() {
  const [editorAContent, setEditorAContent] = useState("");
  const [editorBContent, setEditorBContent] = useState("");

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-800 to-black p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-6 text-center">
          Two-Panel Text Editor
        </h1>

        {/* Two-panel layout: side-by-side on desktop, stacked on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Editor A */}
          <Card className="flex flex-col h-full bg-white/10 backdrop-blur-md border-white/20 shadow-xl">
            <CardHeader className="pb-0 bg-white/5 border-b border-white/20">
              <CardTitle id="editor-a-label" className="text-white">
                Editor A
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col pt-4">
              <Textarea
                value={editorAContent}
                onChange={(e) => setEditorAContent(e.target.value)}
                placeholder="Start typing in Editor A..."
                aria-labelledby="editor-a-label"
                className="flex-1 min-h-[400px] lg:min-h-[600px] resize-none bg-transparent text-white placeholder-white/40 focus-visible:ring-blue-400"
              />
            </CardContent>
          </Card>

          {/* Editor B */}
          <Card className="flex flex-col h-full bg-white/10 backdrop-blur-md border-white/20 shadow-xl">
            <CardHeader className="pb-0 bg-white/5 border-b border-white/20">
              <CardTitle id="editor-b-label" className="text-white">
                Editor B
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col pt-4">
              <Textarea
                value={editorBContent}
                onChange={(e) => setEditorBContent(e.target.value)}
                placeholder="Start typing in Editor B..."
                aria-labelledby="editor-b-label"
                className="flex-1 min-h-[400px] lg:min-h-[600px] resize-none bg-transparent text-white placeholder-white/40 focus-visible:ring-green-400"
              />
            </CardContent>
          </Card>
        </div>

        {/* Character count info */}
        <div className="mt-4 flex flex-col lg:flex-row gap-4 text-white/60 text-sm">
          <div className="flex-1 text-center lg:text-left">
            Editor A: {editorAContent.length} characters
          </div>
          <div className="flex-1 text-center lg:text-right">
            Editor B: {editorBContent.length} characters
          </div>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/demo/two-panel-editor")({
  component: TwoPanelEditor,
});
