export type LatexDocumentOptions = {
  readonly author?: string;
  readonly title?: string;
};

const LATEX_SPECIAL_CHARACTER = /[\\{}$&#_%~^]/g;
const LATEX_ESCAPE: Readonly<Record<string, string>> = {
  "#": "\\#",
  $: "\\$",
  "%": "\\%",
  "&": "\\&",
  "\\": "\\textbackslash{}",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "^": "\\textasciicircum{}",
  "~": "\\textasciitilde{}",
};

export const escapeLatex = (value: string): string =>
  value.replace(
    LATEX_SPECIAL_CHARACTER,
    (character) => LATEX_ESCAPE[character] ?? character,
  );

const renderInline = (value: string): string => {
  const tokens: string[] = [];
  const tokenized = value.replace(
    /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g,
    (
      _match,
      code: string | undefined,
      label: string | undefined,
      url: string | undefined,
    ) => {
      const replacement =
        code !== undefined
          ? `\\texttt{${escapeLatex(code)}}`
          : `\\href{${escapeLatex(url ?? "")}}{${renderInline(label ?? "")}}`;
      const token = `@@SOFTMAPLE${tokens.length}@@`;
      tokens.push(replacement);
      return token;
    },
  );

  const normalizedStyles = tokenized
    .replace(/___(.+?)___/g, "***$1***")
    .replace(/__(.+?)__/g, "**$1**")
    .replace(/_([^_]+?)_/g, "*$1*");

  const styled = escapeLatex(normalizedStyles)
    .replace(/\*\*\*(.+?)\*\*\*/g, "\\textbf{\\textit{$1}}")
    .replace(/\*\*(.+?)\*\*/g, "\\textbf{$1}")
    .replace(/\*(.+?)\*/g, "\\textit{$1}")
    .replace(/~~(.+?)~~/g, "\\sout{$1}");

  return tokens.reduce(
    (result, token, index) => result.replace(`@@SOFTMAPLE${index}@@`, token),
    styled,
  );
};

const headingCommand = (level: number): string =>
  ["section", "subsection", "subsubsection", "paragraph", "subparagraph"][
    Math.min(level, 5) - 1
  ] ?? "paragraph";

export const markdownToLatexBody = (markdown: string): string => {
  const output: string[] = [];
  let listType: "enumerate" | "itemize" | null = null;
  let inBlockquote = false;
  let inCodeBlock = false;

  const closeList = () => {
    if (listType !== null) output.push(`\\end{${listType}}`);
    listType = null;
  };
  const closeBlockquote = () => {
    if (inBlockquote) output.push("\\end{quote}");
    inBlockquote = false;
  };

  for (const rawLine of markdown.split("\n")) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      closeList();
      closeBlockquote();
      output.push(inCodeBlock ? "\\end{verbatim}" : "\\begin{verbatim}");
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      output.push(rawLine);
      continue;
    }

    if (trimmed.length === 0) {
      closeList();
      closeBlockquote();
      if (output.at(-1) !== "") output.push("");
      continue;
    }

    const blockquoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (blockquoteMatch !== null) {
      closeList();
      if (!inBlockquote) output.push("\\begin{quote}");
      inBlockquote = true;
      output.push(`${renderInline(blockquoteMatch[1] ?? "")}\\\\`);
      continue;
    }
    closeBlockquote();

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch !== null) {
      closeList();
      output.push(
        `\\${headingCommand(headingMatch[1]?.length ?? 1)}{${renderInline(headingMatch[2] ?? "")}}`,
      );
      continue;
    }

    const checklistMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/);
    const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    const nextListType = orderedMatch === null ? "itemize" : "enumerate";
    if (
      checklistMatch !== null ||
      unorderedMatch !== null ||
      orderedMatch !== null
    ) {
      if (listType !== nextListType) {
        closeList();
        output.push(`\\begin{${nextListType}}`);
        listType = nextListType;
      }
      if (checklistMatch !== null) {
        const checked = checklistMatch[1]?.toLowerCase() === "x";
        output.push(
          `  \\item[$${checked ? "\\boxtimes" : "\\square"}$] ${renderInline(checklistMatch[2] ?? "")}`,
        );
      } else {
        output.push(
          `  \\item ${renderInline(orderedMatch?.[1] ?? unorderedMatch?.[1] ?? "")}`,
        );
      }
      continue;
    }

    closeList();
    output.push(`${renderInline(trimmed)}\\\\`);
  }

  closeList();
  closeBlockquote();
  if (inCodeBlock) output.push("\\end{verbatim}");
  while (output.at(-1) === "") output.pop();
  return output.join("\n");
};

export const markdownToLatex = (
  markdown: string,
  options: LatexDocumentOptions = {},
): string => {
  const title = escapeLatex(options.title ?? "Untitled document");
  const authorLine =
    options.author === undefined
      ? ""
      : `\n\\author{${escapeLatex(options.author)}}`;
  const body = markdownToLatexBody(markdown);
  return `\\documentclass{article}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{amssymb}
\\usepackage[hidelinks]{hyperref}
\\usepackage[normalem]{ulem}
\\title{${title}}${authorLine}
\\date{}

\\begin{document}
\\maketitle

${body}

\\end{document}
`;
};
