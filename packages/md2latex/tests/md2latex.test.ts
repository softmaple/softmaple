import { describe, expect, test } from "vitest";
import {
  escapeLatex,
  markdownToLatex,
  markdownToLatexBody,
} from "../src/md2latex";

describe("inline formatting", () => {
  test("bold text", () => {
    expect(markdownToLatexBody("**bold**")).toBe("\\textbf{bold}\\\\");
    expect(markdownToLatexBody("__bold__")).toBe("\\textbf{bold}\\\\");
  });

  test("italic text", () => {
    expect(markdownToLatexBody("*italic*")).toBe("\\textit{italic}\\\\");
    expect(markdownToLatexBody("_italic_")).toBe("\\textit{italic}\\\\");
  });

  test("bold and italic", () => {
    expect(markdownToLatexBody("***bold-italic***")).toBe(
      "\\textbf{\\textit{bold-italic}}\\\\",
    );
  });

  test("inline code", () => {
    expect(markdownToLatexBody("`code`")).toBe("\\texttt{code}\\\\");
  });
});

describe("block elements", () => {
  test("headers", () => {
    expect(markdownToLatexBody("# Header 1")).toBe("\\section{Header 1}");
    expect(markdownToLatexBody("## Header 2")).toBe("\\subsection{Header 2}");
    expect(markdownToLatexBody("### Header 3")).toBe(
      "\\subsubsection{Header 3}",
    );
  });

  test("unordered lists", () => {
    const md = `
- Item 1
- Item 2`;
    const expected = `\\begin{itemize}
  \\item Item 1
  \\item Item 2
\\end{itemize}`;
    expect(markdownToLatexBody(md).trim()).toBe(expected);
  });

  test("ordered lists", () => {
    const md = `
1. First
2. Second`;
    const expected = `\\begin{enumerate}
  \\item First
  \\item Second
\\end{enumerate}`;
    expect(markdownToLatexBody(md).trim()).toBe(expected);
  });

  test("blockquotes", () => {
    const md = "> quoted text";
    const expected = `\\begin{quote}
quoted text\\\\
\\end{quote}`;
    expect(markdownToLatexBody(md)).toBe(expected);
  });

  test("code blocks", () => {
    const md = "```\ncode line\n```";
    const expected = `\\begin{verbatim}
code line
\\end{verbatim}`;
    expect(markdownToLatexBody(md)).toBe(expected);
  });

  test("unclosed blockquote at end", () => {
    const md = "> quote line 1\n> quote line 2";
    const expected = `\\begin{quote}\nquote line 1\\\\\nquote line 2\\\\\n\\end{quote}`;
    expect(markdownToLatexBody(md)).toBe(expected);
  });

  test("unclosed list at end", () => {
    const md = "- Item 1\n- Item 2";
    const expected = `\\begin{itemize}\n  \\item Item 1\n  \\item Item 2\n\\end{itemize}`;
    expect(markdownToLatexBody(md)).toBe(expected);
  });

  test("unclosed code block at end", () => {
    const md = "```\ncode line 1\ncode line 2";
    const expected = `\\begin{verbatim}\ncode line 1\ncode line 2\n\\end{verbatim}`;
    expect(markdownToLatexBody(md)).toBe(expected);
  });

  test("switching from ordered to unordered list", () => {
    const md = `1. Ordered item\n- Unordered item`;
    const expected = `\\begin{enumerate}\n  \\item Ordered item\n\\end{enumerate}\n\\begin{itemize}\n  \\item Unordered item\n\\end{itemize}`;
    expect(markdownToLatexBody(md)).toBe(expected);
  });
});

describe("complex scenarios", () => {
  test("mixed inline styles", () => {
    expect(markdownToLatexBody("**bold *italic* text**")).toBe(
      "\\textbf{bold \\textit{italic} text}\\\\",
    );
  });

  test("empty input", () => {
    expect(markdownToLatexBody("")).toBe("");
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
    expect(markdownToLatexBody(md).trim()).toBe(expected);
  });

  test("blockquote ending with non-blockquote line", () => {
    const md = `> quoted line\nregular line`;
    const expected = `\\begin{quote}\nquoted line\\\\\n\\end{quote}\nregular line\\\\`;
    expect(markdownToLatexBody(md)).toBe(expected);
  });

  test("switching between list types", () => {
    const md = `- Unordered item\n1. Ordered item`;
    const expected = `\\begin{itemize}\n  \\item Unordered item\n\\end{itemize}\n\\begin{enumerate}\n  \\item Ordered item\n\\end{enumerate}`;
    expect(markdownToLatexBody(md)).toBe(expected);
  });

  test("list ending with non-list line", () => {
    const md = `- List item\nregular text`;
    const expected = `\\begin{itemize}\n  \\item List item\n\\end{itemize}\nregular text\\\\`;
    expect(markdownToLatexBody(md)).toBe(expected);
  });
});

describe("complete LaTeX documents", () => {
  test("escapes reserved characters", () => {
    expect(escapeLatex("50% R&D_1 #2")).toBe("50\\% R\\&D\\_1 \\#2");
  });

  test("converts links and checklists", () => {
    expect(
      markdownToLatexBody("- [x] Read [notes](https://example.com/a_b)"),
    ).toContain(
      "\\item[$\\boxtimes$] Read \\href{https://example.com/a\\_b}{notes}",
    );
  });

  test("wraps the converted body in a compilable document", () => {
    const latex = markdownToLatex("# Results", { title: "A&B" });
    expect(latex).toContain("\\title{A\\&B}");
    expect(latex).toContain("\\begin{document}");
    expect(latex).toContain("\\section{Results}");
    expect(latex).toContain("\\end{document}");
  });
});
