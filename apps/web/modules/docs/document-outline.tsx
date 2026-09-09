"use client";
import { useEffect, useState } from "react";
import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";

export function DocumentOutline({
  binding,
  onNavigate,
}: {
  readonly binding: LexicalBinding | null;
  readonly onNavigate: (anchor: StableBlockSelection) => void;
}) {
  const [headings, setHeadings] = useState<
    readonly { id: string; text: string; level: string }[]
  >([]);
  useEffect(() => {
    if (binding === null) return;
    const update = () =>
      setHeadings(
        binding.replica
          .getDocument()
          .blocks.filter((block) => /^h[123]$/.test(block.type))
          .map((block) => ({
            id: block.id,
            text: block.text,
            level: block.type,
          })),
      );
    update();
    return binding.replica.subscribe(update);
  }, [binding]);
  return (
    <details className="border-b px-4 py-2 text-xs">
      <summary className="cursor-pointer py-1 text-muted-foreground">
        Document outline · {headings.length} sections
      </summary>
      <nav
        aria-label="Document outline"
        className="flex max-h-48 flex-col overflow-auto py-2"
      >
        {headings.length === 0 ? (
          <p className="py-2 text-muted-foreground">
            Headings create a navigable outline here.
          </p>
        ) : (
          headings.map((heading) => (
            <button
              key={heading.id}
              className="min-h-11 rounded-lg px-3 text-left hover:bg-accent"
              onClick={() => {
                const point = {
                  blockId: heading.id,
                  anchor: {
                    type: "boundary",
                    edge: "start",
                    affinity: "after",
                  } as const,
                };
                onNavigate({ anchor: point, focus: point });
              }}
            >
              {heading.text || "Untitled section"}
            </button>
          ))
        )}
      </nav>
    </details>
  );
}
