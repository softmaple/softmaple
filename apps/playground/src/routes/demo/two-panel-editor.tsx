import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

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
          <div className="flex flex-col bg-white/10 backdrop-blur-md rounded-lg border border-white/20 shadow-xl overflow-hidden">
            <div className="bg-white/5 border-b border-white/20 px-4 py-3">
              <h2
                id="editor-a-label"
                className="text-xl font-semibold text-white"
              >
                Editor A
              </h2>
            </div>
            <textarea
              value={editorAContent}
              onChange={(e) => setEditorAContent(e.target.value)}
              placeholder="Start typing in Editor A..."
              aria-labelledby="editor-a-label"
              className="flex-1 w-full p-4 bg-transparent text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none min-h-[400px] lg:min-h-[600px]"
            />
          </div>

          {/* Editor B */}
          <div className="flex flex-col bg-white/10 backdrop-blur-md rounded-lg border border-white/20 shadow-xl overflow-hidden">
            <div className="bg-white/5 border-b border-white/20 px-4 py-3">
              <h2
                id="editor-b-label"
                className="text-xl font-semibold text-white"
              >
                Editor B
              </h2>
            </div>
            <textarea
              value={editorBContent}
              onChange={(e) => setEditorBContent(e.target.value)}
              placeholder="Start typing in Editor B..."
              aria-labelledby="editor-b-label"
              className="flex-1 w-full p-4 bg-transparent text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-400 resize-none min-h-[400px] lg:min-h-[600px]"
            />
          </div>
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
