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
    <Card className="flex-1 guofeng-editor-card guofeng-shadow-hover">
      <CardContent className="flex flex-col h-full p-0">
        <div className="p-4 guofeng-editor-header">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm guofeng-text-muted">
              Active participants:
            </span>
            {participants.map((user) => (
              <Badge
                key={user.id}
                variant="secondary"
                className="text-xs guofeng-participant-badge"
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
              <span className="text-xs guofeng-text-muted">
                No other participants yet
              </span>
            )}
          </div>
        </div>
        <div className="flex-1 relative guofeng-editor-area">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={onChange}
            placeholder="Start typing collaboratively..."
            className="h-full w-full min-h-[400px] resize-none guofeng-textarea"
            aria-label="Collaborative text editor"
            aria-describedby="editor-description"
          />
          <span id="editor-description" className="sr-only">
            This is a collaborative text editor. Your changes are automatically
            synchronized with other participants in real-time.
          </span>
        </div>
        <div className="p-2 guofeng-editor-footer">
          <p className="text-xs guofeng-text-muted text-center">
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
