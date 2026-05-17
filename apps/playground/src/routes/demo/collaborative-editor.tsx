import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { Textarea } from "@softmaple/ui/components/textarea";
import { createFileRoute } from "@tanstack/react-router";
import type { ChangeEvent, RefObject } from "react";
import { useCollaborativeEditor } from "@/modules/collaborative-editor/use-collaborative-editor";

export const Route = createFileRoute("/demo/collaborative-editor")({
  component: CollaborativeEditor,
});

type ReplicaEditorPanelProps = {
  readonly editorRef: RefObject<HTMLTextAreaElement | null>;
  readonly label: string;
  readonly labelId: string;
  readonly testId: string;
  readonly value: string;
  readonly onChange: (
    event: ChangeEvent<HTMLTextAreaElement>,
  ) => Promise<void>;
  readonly placeholder: string;
  readonly focusRingClassName: string;
};

function ReplicaEditorPanel({
  editorRef,
  label,
  labelId,
  testId,
  value,
  onChange,
  placeholder,
  focusRingClassName,
}: ReplicaEditorPanelProps) {
  return (
    <Card className="flex flex-col h-full bg-white/10 backdrop-blur-md border-white/20 shadow-xl gap-0 py-0">
      <CardHeader className="bg-white/5 border-b border-white/20 px-4 py-3">
        <CardTitle id={labelId} className="text-xl text-white">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 p-0">
        <Textarea
          ref={editorRef}
          data-testid={testId}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          aria-labelledby={labelId}
          className={`h-full w-full min-h-[400px] lg:min-h-[600px] resize-none bg-transparent text-white placeholder-white/40 focus-visible:ring-2 border-0 rounded-none p-4 ${focusRingClassName}`}
        />
      </CardContent>
    </Card>
  );
}

function CollaborativeEditor() {
  const {
    replica1Text,
    replica2Text,
    replica1Ref,
    replica2Ref,
    handleReplica1Change,
    handleReplica2Change,
  } = useCollaborativeEditor();

  const replicaEditors: readonly ReplicaEditorPanelProps[] = [
    {
      editorRef: replica1Ref,
      label: "Replica 1",
      labelId: "replica-1-label",
      testId: "replica-1",
      value: replica1Text,
      onChange: handleReplica1Change,
      placeholder: "Start typing in Replica 1...",
      focusRingClassName: "focus-visible:ring-blue-400",
    },
    {
      editorRef: replica2Ref,
      label: "Replica 2",
      labelId: "replica-2-label",
      testId: "replica-2",
      value: replica2Text,
      onChange: handleReplica2Change,
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
