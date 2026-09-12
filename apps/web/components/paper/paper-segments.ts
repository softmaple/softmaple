/**
 * Splitting the paper's source into what react-markdown can render and what
 * only the app can.
 *
 * A figure is a fenced block tagged `figure:<id>` whose body is its caption.
 * Keeping figures inside the source — rather than interleaving them in the
 * Read view alone — is what lets all three views stay the same document: the
 * Markdown view shows the fence, LaTeX renders the caption, and the Read view
 * puts the live figure in its place.
 */

export type PaperSegment =
  | { readonly kind: "prose"; readonly markdown: string }
  | { readonly kind: "figure"; readonly id: string; readonly caption: string };

const FIGURE_BLOCK = /^```figure:([\w-]+)\n([\s\S]*?)\n```$/gm;

export const splitFigures = (source: string): readonly PaperSegment[] => {
  const segments: PaperSegment[] = [];
  let cursor = 0;

  for (const match of source.matchAll(FIGURE_BLOCK)) {
    const [block, id, caption] = match;
    const start = match.index;
    const prose = source.slice(cursor, start).trim();
    if (prose.length > 0) segments.push({ kind: "prose", markdown: prose });
    if (id !== undefined && caption !== undefined) {
      segments.push({ caption: caption.trim(), id, kind: "figure" });
    }
    cursor = start + block.length;
  }

  const tail = source.slice(cursor).trim();
  if (tail.length > 0) segments.push({ kind: "prose", markdown: tail });
  return segments;
};

/** Section headings, in order, for the reading-position rail. */
export const sectionTitles = (source: string): readonly string[] =>
  source
    .split("\n")
    .filter((line) => line.startsWith("# "))
    .map((line) => line.slice(2).trim());
