import { Textarea } from "@softmaple/ui/components/textarea";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { DemoPageShell } from "@/components/demo/DemoPageShell";

function TwoPanelEditor() {
  const [editorAContent, setEditorAContent] = useState("");
  const [editorBContent, setEditorBContent] = useState("");

  return (
    <DemoPageShell
      eyebrow="05 · Local editors"
      title="Two-Panel Text Editor"
      description="Independent text editors side-by-side. Useful for comparing drafts, note-taking, or dual-language editing."
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="pg-panel flex h-full flex-col overflow-hidden">
          <div className="pg-panel-header px-4 py-3">
            <h2
              id="editor-a-label"
              className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-[-0.02em]"
            >
              Editor A
            </h2>
          </div>
          <Textarea
            value={editorAContent}
            onChange={(e) => setEditorAContent(e.target.value)}
            placeholder="Start typing in Editor A..."
            aria-labelledby="editor-a-label"
            className="h-full min-h-[400px] w-full resize-none rounded-none border-0 bg-transparent p-4 text-[var(--pg-ink)] placeholder:text-[var(--pg-ink-muted)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)] lg:min-h-[600px]"
          />
        </section>

        <section className="pg-panel flex h-full flex-col overflow-hidden">
          <div className="pg-panel-header px-4 py-3">
            <h2
              id="editor-b-label"
              className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-[-0.02em]"
            >
              Editor B
            </h2>
          </div>
          <Textarea
            value={editorBContent}
            onChange={(e) => setEditorBContent(e.target.value)}
            placeholder="Start typing in Editor B..."
            aria-labelledby="editor-b-label"
            className="h-full min-h-[400px] w-full resize-none rounded-none border-0 bg-transparent p-4 text-[var(--pg-ink)] placeholder:text-[var(--pg-ink-muted)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)] lg:min-h-[600px]"
          />
        </section>
      </div>

      <div className="mt-4 flex flex-col gap-2 font-[family-name:var(--font-mono)] text-xs text-[var(--pg-ink-muted)] lg:flex-row lg:justify-between">
        <p>Editor A: {editorAContent.length} characters</p>
        <p>Editor B: {editorBContent.length} characters</p>
      </div>
    </DemoPageShell>
  );
}

export const Route = createFileRoute("/demo/two-panel-editor")({
  ssr: false,
  component: TwoPanelEditor,
});
