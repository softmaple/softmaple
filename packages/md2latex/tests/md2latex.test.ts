import { describe, expect, test } from "vitest";
import { markdownToLatex } from "../src/md2latex";

describe("inline formatting", () => {
  test("bold text", () => {
    expect(markdownToLatex("**bold**")).toBe("\\textbf{bold}\\\\");
    expect(markdownToLatex("__bold__")).toBe("\\textbf{bold}\\\\");
  });

  test("italic text", () => {
    expect(markdownToLatex("*italic*")).toBe("\\textit{italic}\\\\");
    expect(markdownToLatex("_italic_")).toBe("\\textit{italic}\\\\");
  });

  test("bold and italic", () => {
    expect(markdownToLatex("***bold-italic***")).toBe(
      "\\textbf{\\textit{bold-italic}}\\\\"
    );
  });

  test("inline code", () => {
    expect(markdownToLatex("`code`")).toBe("\\texttt{code}\\\\");
  });
});

describe("block elements", () => {
  test("headers", () => {
    expect(markdownToLatex("# Header 1")).toBe("\\section{Header 1}");
    expect(markdownToLatex("## Header 2")).toBe("\\subsection{Header 2}");
    expect(markdownToLatex("### Header 3")).toBe("\\subsubsection{Header 3}");
  });

  test("unordered lists", () => {
    const md = `
- Item 1
- Item 2`;
    const expected = `\\begin{itemize}
  \\item Item 1
  \\item Item 2
\\end{itemize}`;
    expect(markdownToLatex(md).trim()).toBe(expected);
  });

  test("ordered lists", () => {
    const md = `
1. First
2. Second`;
    const expected = `\\begin{enumerate}
  \\item First
  \\item Second
\\end{enumerate}`;
    expect(markdownToLatex(md).trim()).toBe(expected);
  });

  test("blockquotes", () => {
    const md = "> quoted text";
    const expected = `\\begin{quote}
quoted text\\\\
\\end{quote}`;
    expect(markdownToLatex(md)).toBe(expected);
  });

  test("code blocks", () => {
    const md = "```\ncode line\n```";
    const expected = `\\begin{verbatim}
code line
\\end{verbatim}`;
    expect(markdownToLatex(md)).toBe(expected);
  });
});

describe("complex scenarios", () => {
  test("mixed inline styles", () => {
    expect(markdownToLatex("**bold *italic* text**")).toBe(
      "\\textbf{bold \\textit{italic} text}\\\\"
    );
  });

  test("empty input", () => {
    expect(markdownToLatex("")).toBe("");
  });

  test("nested lists", () => {
    const md = `
- Item 1
  - Nested 1
- Item 2`;
    const expected = `\\begin{itemize}
  \\item Item 1
  \\item Nested 1
  \\item Item 2
\\end{itemize}`;
    expect(markdownToLatex(md).trim()).toBe(expected);
  });
});
