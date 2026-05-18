import { createFileRoute } from "@tanstack/react-router";
import {
  ReplicaEditorPanel,
  type ReplicaEditorPanelProps,
} from "@/components/collab-editor/ReplicaEditorPanel";
import { useCollaborativeEditor } from "@/modules/collaborative-editor/use-collaborative-editor";

export const Route = createFileRoute("/demo/collaborative-editor")({
  component: CollaborativeEditor,
});

function CollaborativeEditor() {
  const { replica1Ref, replica2Ref } = useCollaborativeEditor();

  const replicaEditors: readonly ReplicaEditorPanelProps[] = [
    {
      editorRef: replica1Ref,
      label: "Replica 1",
      labelId: "replica-1-label",
      testId: "replica-1",
      placeholder: "Start typing in Replica 1...",
      focusRingClassName: "focus-visible:ring-blue-400",
    },
    {
      editorRef: replica2Ref,
      label: "Replica 2",
      labelId: "replica-2-label",
      testId: "replica-2",
      placeholder: "Start typing in Replica 2...",
      focusRingClassName: "focus-visible:ring-green-400",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-center">
          Collaborative Text Editor
        </h1>
        <p className="text-center text-white/70 mb-8">
          Powered by <strong>Eg-Walker CRDT Algorithm</strong>. Type in either
          editor to see real-time synchronization.
        </p>

        {/* Two-panel layout: side-by-side on desktop, stacked on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {replicaEditors.map((editor) => (
            <ReplicaEditorPanel key={editor.testId} {...editor} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default CollaborativeEditor;
