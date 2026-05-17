import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { Textarea } from "@softmaple/ui/components/textarea";
import type { ChangeEvent, RefObject } from "react";

export type ReplicaEditorPanelProps = {
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

export function ReplicaEditorPanel({
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
