/**
 * Line classification for the two source views.
 *
 * Just enough to read source as source — the lines that open a block get the
 * accent, everything else is body. A tokenizer would be a highlighter
 * dependency for one page; this is a pure function over a string.
 */

export type SourceSyntax = "markdown" | "latex";

export type LineTone = "accent" | "muted" | "body";

export const lineTone = (line: string, syntax: SourceSyntax): LineTone => {
  const trimmed = line.trimStart();
  if (trimmed.length === 0) return "body";
  if (syntax === "latex") {
    return trimmed.startsWith("\\") ? "accent" : "body";
  }
  if (trimmed.startsWith("#") || trimmed.startsWith("```")) return "accent";
  if (trimmed.startsWith(">") || trimmed.startsWith("- ")) return "muted";
  return "body";
};

export const toSourceLines = (
  source: string,
  syntax: SourceSyntax,
): ReadonlyArray<{ readonly text: string; readonly tone: LineTone }> =>
  source
    .replace(/\n+$/, "")
    .split("\n")
    .map((text) => ({ text, tone: lineTone(text, syntax) }));
