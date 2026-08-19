# `@softmaple/md2latex`

A dependency-free Markdown → $\LaTeX$ transformer. Given the Markdown that
the Lexical editor exports, it produces either a document body or a complete
compilable `article` document.

The whole package is pure functions over strings: no AST library, no I/O, no
`\write18`, no shelling out to a $\TeX$ distribution. That keeps it safe to run
in a browser, a server action, or a Worker alike.

## Role in the stack

```text
          packages/editor                      apps/web
     ExportFilesDropdownMenu           latex-pane · doc-header
                    │                               │
             $convertToMarkdownString / lexicalStateToMarkdown
                    └───────────────┬───────────────┘
                                    │
                                markdown
                                    ▼
                           @softmaple/md2latex
                    ┌───────────────┴───────────────┐
                    │                               │
             tokenizeInline                   block scanner
           code · links · bold              headings · lists
             italic · strike                 quotes · fences
                    │                               │
                    └───────────────┬───────────────┘
                    ┌───────────────┴───────────────┐
                    │                               │
           markdownToLatexBody               markdownToLatex
              body fragment                full \documentclass
                    │                               │
                    └───────────────┬───────────────┘
                                    │
                             .tex → pdflatex
```

Inline content is tokenized **before** block rendering: code spans and link
URLs are replaced by `@@SOFTMAPLE<n>@@` placeholders, the surrounding text is
escaped, and the placeholders are substituted back. That is why a `$` inside a
backtick span survives as a literal `$` while a `$` in prose becomes `\$`.

## Usage

```ts
import { markdownToLatex, markdownToLatexBody, escapeLatex } from "@softmaple/md2latex";

// Complete document, ready for pdflatex.
const tex = markdownToLatex(markdown, {
  title: "On Convergent Editing",
  author: "Ada Lovelace",
});

// Just the body, when you own the preamble.
const body = markdownToLatexBody(markdown);

// Escape a single untrusted string for LaTeX.
const safe = escapeLatex("100% & counting_up");
// → "100\\% \\& counting\\_up"
```

`markdownToLatex` emits an `article` document with `fontenc`, `inputenc`,
`amssymb` (checklist boxes), `hyperref` (links, `hidelinks`), and `ulem`
(strikethrough), plus `\maketitle`. `title` defaults to `Untitled document`;
omitting `author` omits the `\author` line entirely rather than emitting an
empty one.

## Mapping

| Markdown | LaTeX |
| --- | --- |
| `#` through `#####` | `\section` → `\subparagraph` (5 levels) |
| `**bold**` | `\textbf{…}` |
| `*italic*` | `\textit{…}` |
| `***both***` | `\textbf{\textit{…}}` |
| `~~strike~~` | `\sout{…}` |
| `` `code` `` | `\texttt{…}` |
| `[label](url)` | `\href{url}{label}` |
| `- item` / `1. item` | `itemize` / `enumerate` |
| `- [ ]` / `- [x]` | `\item[$\square$]` / `\item[$\boxtimes$]` |
| `> quote` | `quote` environment |
| ` ```fence ``` ` | `verbatim` (contents passed through unescaped) |
| paragraph line | text plus an explicit `\\` line break |

### Escaping

`\ { } $ & # _ % ~ ^` are escaped everywhere except inside a `verbatim` block.
`\` becomes `\textbackslash{}`, `~` becomes `\textasciitilde{}`, and `^`
becomes `\textasciicircum{}` — not the bare accent forms, which would silently
consume the following character.

An unterminated code fence, list, or blockquote is closed at end of input, so
the output is always a balanced document rather than a partially-open
environment that breaks the whole compile.

## Commands

```bash
pnpm --filter @softmaple/md2latex build
pnpm --filter @softmaple/md2latex test
pnpm --filter @softmaple/md2latex coverage
pnpm --filter @softmaple/md2latex typecheck
pnpm --filter @softmaple/md2latex lint
```

Tests live in [`tests/md2latex.test.ts`](./tests/md2latex.test.ts) (Vitest).
Every mapping row above is worth a test case — this converter's failure mode is
a `.tex` file that no longer compiles, which is far more expensive to debug
than a failing assertion.
