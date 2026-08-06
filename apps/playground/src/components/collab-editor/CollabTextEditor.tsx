import { Badge } from "@softmaple/ui/components/badge";
import { Card, CardContent } from "@softmaple/ui/components/card";
import { Textarea } from "@softmaple/ui/components/textarea";
import type { RefObject } from "react";
import type { User } from "../../modules/collab-editor/types";

interface CollabTextEditorProps {
  text: string;
  participants: User[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

export function CollabTextEditor({
  text,
  participants,
  textareaRef,
  onChange,
}: CollabTextEditorProps) {
  return (
    <Card className="pg-panel flex-1 overflow-hidden rounded-none border-[var(--pg-line)] bg-[var(--pg-surface)] shadow-none">
      <CardContent className="flex h-full flex-col p-0">
        <div className="pg-panel-header p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-[var(--pg-ink-muted)]">
              Active participants:
            </span>
            {participants.map((user) => (
              <Badge
                key={user.id}
                variant="secondary"
                className="border text-xs"
                style={{
                  backgroundColor: `${user.color}15`,
                  borderColor: user.color,
                  color: user.color,
                }}
                aria-label={`Participant: ${user.name}`}
              >
                {user.name}
              </Badge>
            ))}
            {participants.length === 0 && (
              <span className="text-xs text-[var(--pg-ink-muted)]">
                No other participants yet
              </span>
            )}
          </div>
        </div>
        <div className="relative flex-1">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={onChange}
            placeholder="Start typing collaboratively..."
            className="h-full min-h-[400px] w-full resize-none rounded-none border-0 bg-transparent p-4 text-[var(--pg-ink)] placeholder:text-[var(--pg-ink-muted)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
            aria-label="Collaborative text editor"
            aria-describedby="editor-description"
          />
          <span id="editor-description" className="sr-only">
            This is a collaborative text editor. Your changes are automatically
            synchronized with other participants in real-time.
          </span>
        </div>
        <div className="pg-panel-footer p-2">
          <p className="text-center font-[family-name:var(--font-mono)] text-xs text-[var(--pg-ink-muted)]">
            <span aria-live="polite" aria-atomic="true">
              {text.length} characters •{" "}
              {text.split(/\s+/).filter(Boolean).length} words
            </span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
