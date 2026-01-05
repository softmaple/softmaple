import { Badge } from "@softmaple/ui/components/badge";
import { Card, CardContent } from "@softmaple/ui/components/card";
import { Textarea } from "@softmaple/ui/components/textarea";
import type { RefObject } from "react";
import type { User } from "../../modules/collab-editor/types";

interface CollabTextEditorProps {
  text: string;
  participants: User[];
  textareaRef: RefObject<HTMLTextAreaElement>;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}

export function CollabTextEditor({
  text,
  participants,
  textareaRef,
  onChange,
}: CollabTextEditorProps) {
  return (
    <Card className="flex-1 bg-zinc-900/50 backdrop-blur-sm border-zinc-700">
      <CardContent className="flex flex-col h-full p-0">
        <div className="p-4 border-b border-zinc-700">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-zinc-400">Active participants:</span>
            {participants.map((user) => (
              <Badge
                key={user.id}
                variant="secondary"
                className="text-xs"
                style={{
                  backgroundColor: `${user.color}20`,
                  color: user.color,
                }}
                aria-label={`Participant: ${user.name}`}
              >
                {user.name}
              </Badge>
            ))}
            {participants.length === 0 && (
              <span className="text-xs text-zinc-500">
                No other participants yet
              </span>
            )}
          </div>
        </div>
        <div className="flex-1 relative">
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={onChange}
            placeholder="Start typing collaboratively..."
            className="h-full w-full min-h-[400px] resize-none bg-transparent text-white placeholder:text-zinc-500 border-0 rounded-none p-4 focus-visible:ring-0"
            aria-label="Collaborative text editor"
            aria-describedby="editor-description"
          />
          <span id="editor-description" className="sr-only">
            This is a collaborative text editor. Your changes are automatically
            synchronized with other participants in real-time.
          </span>
        </div>
        <div className="p-2 border-t border-zinc-700 bg-zinc-800/30">
          <p className="text-xs text-zinc-500 text-center">
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
