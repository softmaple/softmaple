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

const INLINE_TOKEN = /@@SOFTMAPLE(\d+)@@/g;

const takeUntil = (value: string, start: number, delimiter: string): number => {
  const end = value.indexOf(delimiter, start);
  return end === -1 ? -1 : end;
};

const tokenizeInline = (
  value: string,
): { readonly tokenized: string; readonly tokens: readonly string[] } => {
  const tokens: string[] = [];
  let output = "";
  let index = 0;

  while (index < value.length) {
    const character = value[index];

    if (character === "`") {
      const end = takeUntil(value, index + 1, "`");
      if (end !== -1) {
        const code = value.slice(index + 1, end);
        const token = `@@SOFTMAPLE${tokens.length}@@`;
        tokens.push(`\\texttt{${escapeLatex(code)}}`);
        output += token;
        index = end + 1;
        continue;
      }
    }

    if (character === "[") {
      const labelEnd = takeUntil(value, index + 1, "]");
      if (
        labelEnd !== -1 &&
        value[labelEnd + 1] === "(" &&
        labelEnd + 2 < value.length
      ) {
        const urlStart = labelEnd + 2;
        let urlEnd = -1;
        for (let cursor = urlStart; cursor < value.length; cursor += 1) {
          const current = value[cursor];
          if (current === ")") {
            urlEnd = cursor;
            break;
          }
          if (current === " " || current === "\t") break;
        }
        if (urlEnd !== -1) {
          const label = value.slice(index + 1, labelEnd);
          const url = value.slice(urlStart, urlEnd);
          const token = `@@SOFTMAPLE${tokens.length}@@`;
          tokens.push(`\\href{${escapeLatex(url)}}{${renderInline(label)}}`);
          output += token;
          index = urlEnd + 1;
          continue;
        }
      }
    }

    output += character;
    index += 1;
  }

  return { tokenized: output, tokens };
};

const replaceDelimited = (
  value: string,
  open: string,
  close: string,
  wrap: (inner: string) => string,
): string => {
  let output = "";
  let index = 0;

  while (index < value.length) {
    if (value.startsWith(open, index)) {
      const contentStart = index + open.length;
      const contentEnd = value.indexOf(close, contentStart);
      if (contentEnd !== -1) {
        output += wrap(value.slice(contentStart, contentEnd));
        index = contentEnd + close.length;
        continue;
      }
    }
    output += value[index];
    index += 1;
  }

  return output;
};

const renderInline = (value: string): string => {
  const { tokenized, tokens } = tokenizeInline(value);

  const normalizedStyles = replaceDelimited(
    replaceDelimited(
      replaceDelimited(tokenized, "___", "___", (inner) => `***${inner}***`),
      "__",
      "__",
      (inner) => `**${inner}**`,
    ),
    "_",
    "_",
    (inner) => `*${inner}*`,
  );

  const styled = replaceDelimited(
    replaceDelimited(
      replaceDelimited(
        replaceDelimited(
          escapeLatex(normalizedStyles),
          "***",
          "***",
          (inner) => `\\textbf{\\textit{${inner}}}`,
        ),
        "**",
        "**",
        (inner) => `\\textbf{${inner}}`,
      ),
      "*",
      "*",
      (inner) => `\\textit{${inner}}`,
    ),
    "~~",
    "~~",
    (inner) => `\\sout{${inner}}`,
  );

  return styled.replace(INLINE_TOKEN, (_match, index: string) => {
    const token = tokens[Number(index)];
    return token ?? "";
  });
};

const headingCommand = (level: number): string =>
  ["section", "subsection", "subsubsection", "paragraph", "subparagraph"][
    Math.min(level, 5) - 1
  ] ?? "paragraph";

const countPrefix = (value: string, character: string, max: number): number => {
  let count = 0;
  while (count < max && value[count] === character) count += 1;
  return count;
};

const skipSpaces = (value: string, start: number): number => {
  let index = start;
  while (index < value.length) {
    const character = value[index];
    if (character !== " " && character !== "\t") break;
    index += 1;
  }
  return index;
};

const parseHeading = (
  trimmed: string,
): { readonly level: number; readonly text: string } | null => {
  const level = countPrefix(trimmed, "#", 6);
  if (level === 0) return null;
  if (trimmed[level] !== " " && trimmed[level] !== "\t") return null;
  const text = trimmed.slice(skipSpaces(trimmed, level));
  return text.length === 0 ? null : { level, text };
};

const parseChecklist = (
  trimmed: string,
): { readonly checked: boolean; readonly text: string } | null => {
  if (trimmed[0] !== "-" && trimmed[0] !== "*") return null;
  let index = skipSpaces(trimmed, 1);
  if (trimmed[index] !== "[") return null;
  const marker = trimmed[index + 1];
  if (
    (marker !== " " && marker !== "x" && marker !== "X") ||
    trimmed[index + 2] !== "]"
  ) {
    return null;
  }
  index = skipSpaces(trimmed, index + 3);
  if (index >= trimmed.length) return null;
  return {
    checked: marker === "x" || marker === "X",
    text: trimmed.slice(index),
  };
};

const parseUnordered = (trimmed: string): string | null => {
  if (trimmed[0] !== "-" && trimmed[0] !== "*") return null;
  if (trimmed[1] !== " " && trimmed[1] !== "\t") return null;
  const text = trimmed.slice(skipSpaces(trimmed, 1));
  return text.length === 0 ? null : text;
};

const parseOrdered = (trimmed: string): string | null => {
  let index = 0;
  while (
    index < trimmed.length &&
    trimmed[index]! >= "0" &&
    trimmed[index]! <= "9"
  ) {
    index += 1;
  }
  if (index === 0 || trimmed[index] !== ".") return null;
  if (trimmed[index + 1] !== " " && trimmed[index + 1] !== "\t") return null;
  const text = trimmed.slice(skipSpaces(trimmed, index + 1));
  return text.length === 0 ? null : text;
};

const parseBlockquote = (trimmed: string): string | null => {
  if (trimmed[0] !== ">") return null;
  if (trimmed.length === 1) return "";
  if (trimmed[1] === " " || trimmed[1] === "\t") return trimmed.slice(2);
  return trimmed.slice(1);
};

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

    const blockquoteText = parseBlockquote(trimmed);
    if (blockquoteText !== null) {
      closeList();
      if (!inBlockquote) output.push("\\begin{quote}");
      inBlockquote = true;
      output.push(`${renderInline(blockquoteText)}\\\\`);
      continue;
    }
    closeBlockquote();

    const heading = parseHeading(trimmed);
    if (heading !== null) {
      closeList();
      output.push(
        `\\${headingCommand(heading.level)}{${renderInline(heading.text)}}`,
      );
      continue;
    }

    const checklist = parseChecklist(trimmed);
    const unordered = checklist === null ? parseUnordered(trimmed) : null;
    const ordered =
      checklist === null && unordered === null ? parseOrdered(trimmed) : null;
    const nextListType = ordered === null ? "itemize" : "enumerate";
    if (checklist !== null || unordered !== null || ordered !== null) {
      if (listType !== nextListType) {
        closeList();
        output.push(`\\begin{${nextListType}}`);
        listType = nextListType;
      }
      if (checklist !== null) {
        output.push(
          `  \\item[$${checklist.checked ? "\\boxtimes" : "\\square"}$] ${renderInline(checklist.text)}`,
        );
      } else {
        output.push(`  \\item ${renderInline(ordered ?? unordered ?? "")}`);
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
