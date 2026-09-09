"use client";

import { useEffect, useState } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { LexicalEgWalkerPlugin } from "@softmaple/binding-lexical/react";
import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
import { LEXICAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import { revealAnchor } from "./document-anchors";

/** A second DOM projection of one replica: no session, transport or write path. */
export function SharedDocumentProjection({
  source,
  anchor,
}: {
  readonly source: LexicalBinding;
  readonly anchor: StableBlockSelection;
}) {
  const [binding, setBinding] = useState<LexicalBinding | null>(null);
  const [pane, setPane] = useState<HTMLDivElement | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  useEffect(() => {
    if (binding === null || pane === null) return;
    let frame = 0;
    const reveal = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setUnresolved(!revealAnchor(binding, anchor, pane)),
      );
    };
    reveal();
    const unsubscribe = binding.replica.subscribe(reveal);
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [anchor, binding, pane]);
  return (
    <div className="shared-projection document-surface" ref={setPane}>
      {unresolved ? (
        <p className="p-4 text-sm text-muted-foreground" role="status">
          This passage is unavailable. Your writing place is preserved.
        </p>
      ) : null}
      <LexicalComposer
        initialConfig={{
          ...LEXICAL_PLAYGROUND_CONFIG,
          namespace: "SoftmapleSharedProjection",
          editable: false,
        }}
      >
        <RichTextPlugin
          contentEditable={
            <ContentEditable aria-label="Shared context, read only" />
          }
          ErrorBoundary={LexicalErrorBoundary}
          placeholder={null}
        />
        <LexicalEgWalkerPlugin
          replica={source.replica}
          mode="read-only"
          onBindingChange={setBinding}
        />
      </LexicalComposer>
    </div>
  );
}
