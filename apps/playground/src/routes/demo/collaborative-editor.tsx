import { createFileRoute } from "@tanstack/react-router";
import {
  ReplicaEditorPanel,
  type ReplicaEditorPanelProps,
} from "@/components/collab-editor/ReplicaEditorPanel";
import { DemoPageShell } from "@/components/demo/DemoPageShell";
import { useCollaborativeEditor } from "@/modules/collaborative-editor/use-collaborative-editor";

export const Route = createFileRoute("/demo/collaborative-editor")({
  ssr: false,
  component: CollaborativeEditor,
});

function CollaborativeEditor() {
  const { replica1Ref, replica2Ref, bindingsReady } = useCollaborativeEditor();

  const replicaEditors: readonly ReplicaEditorPanelProps[] = [
    {
      editorRef: replica1Ref,
      label: "Replica 1",
      labelId: "replica-1-label",
      testId: "replica-1",
      placeholder: "Start typing in Replica 1...",
      focusRingClassName: "focus-visible:ring-[var(--pg-accent)]",
    },
    {
      editorRef: replica2Ref,
      label: "Replica 2",
      labelId: "replica-2-label",
      testId: "replica-2",
      placeholder: "Start typing in Replica 2...",
      focusRingClassName: "focus-visible:ring-teal-400",
    },
  ];

  return (
    <DemoPageShell
      eyebrow="04 · Eg-Walker CRDT"
      title="Collaborative Text Editor"
      description={
        <>
          Powered by{" "}
          <strong className="text-[var(--pg-ink)]">
            Eg-Walker CRDT Algorithm
          </strong>
          . Type in either editor to see real-time synchronization.
        </>
      }
    >
      <div
        className="grid grid-cols-1 gap-4 lg:grid-cols-2"
        data-bindings-ready={bindingsReady ? "true" : "false"}
      >
        {replicaEditors.map((editor) => (
          <ReplicaEditorPanel key={editor.testId} {...editor} />
        ))}
      </div>
    </DemoPageShell>
  );
}

export default CollaborativeEditor;
