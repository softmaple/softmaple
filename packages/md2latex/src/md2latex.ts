export function markdownToLatex(markdown) {
  const lines = markdown.split("\n");
  const latexLines = [];

  let inList = false;
  let listType = ""; // 'itemize' or 'enumerate'
  let inBlockquote = false;
  let inCodeBlock = false;

  for (let rawLine of lines) {
    let line = rawLine.trim();

    // Handle code blocks
    if (/^```/.test(line)) {
      if (!inCodeBlock) {
        latexLines.push("\\begin{verbatim}");
        inCodeBlock = true;
      } else {
        latexLines.push("\\end{verbatim}");
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      latexLines.push(rawLine); // preserve indentation
      continue;
    }

    // Blockquotes
    if (line.startsWith(">")) {
      if (!inBlockquote) {
        latexLines.push("\\begin{quote}");
        inBlockquote = true;
      }
      line = line.replace(/^>\s?/, "");
    } else if (inBlockquote) {
      latexLines.push("\\end{quote}");
      inBlockquote = false;
    }

    // Headings
    if (/^#{1,6} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      const content = line.replace(/^#{1,6} /, "");
      const headingMap = {
        1: "section",
        2: "subsection",
        3: "subsubsection",
        4: "paragraph",
        5: "subparagraph",
        6: "textbf",
      };
      const latexHeading = headingMap[level];
      latexLines.push(`\\${latexHeading}{${content}}`);
      continue;
    }

    // Lists
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    const olMatch = line.match(/^\d+\.\s+(.+)/);

    if (ulMatch) {
      if (!inList || listType !== "itemize") {
        if (inList) latexLines.push(`\\end{${listType}}`);
        latexLines.push("\\begin{itemize}");
        inList = true;
        listType = "itemize";
      }
      latexLines.push(`  \\item ${applyInlineStyles(ulMatch[1])}`);
      continue;
    } else if (olMatch) {
      if (!inList || listType !== "enumerate") {
        if (inList) latexLines.push(`\\end{${listType}}`);
        latexLines.push("\\begin{enumerate}");
        inList = true;
        listType = "enumerate";
      }
      latexLines.push(`  \\item ${applyInlineStyles(olMatch[1])}`);
      continue;
    } else if (inList) {
      latexLines.push(`\\end{${listType}}`);
      inList = false;
      listType = "";
    }

    // Plain text (paragraphs)
    if (line !== "") {
      latexLines.push(applyInlineStyles(line) + "\\\\");
    }
  }

  if (inBlockquote) latexLines.push("\\end{quote}");
  if (inList) latexLines.push(`\\end{${listType}}`);
  if (inCodeBlock) latexLines.push("\\end{verbatim}");

  return latexLines.join("\n");
}

// Helper: nested bold/italic/code (recursive)
const applyInlineStyles = (text) => {
  if (!text) return "";

  // Handle inline code first (no nesting inside it)
  text = text.replace(/`([^`]+?)`/g, (_, code) => `\\texttt{${code}}`);

  // Bold+Italic (***) or (___)
  text = text.replace(
    /(\*\*\*|___)(.+?)\1/g,
    (_, __, content) => `\\textbf{\\textit{${applyInlineStyles(content)}}}`
  );

  // Bold (** or __)
  text = text.replace(
    /(\*\*|__)(.+?)\1/g,
    (_, __, content) => `\\textbf{${applyInlineStyles(content)}}`
  );

  // Italic (* or _)
  text = text.replace(
    /(\*|_)(.+?)\1/g,
    (_, __, content) => `\\textit{${applyInlineStyles(content)}}`
  );

  return text;
};
