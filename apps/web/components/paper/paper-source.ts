/**
 * The landing page, as a document.
 *
 * This string is the single source for all three views of the page. The Read
 * view renders it, the Markdown view shows it verbatim, and the LaTeX view is
 * `markdownToLatex()` from `@softmaple/md2latex` — the same converter the
 * editor ships with — run over this exact text. Nothing on the page is a
 * mock-up of the product's output; it is the product's output.
 *
 * Only syntax `@softmaple/md2latex` understands appears here, so all three
 * views stay faithful to one another. Figures are fenced blocks tagged
 * `figure:<id>`: the Read view swaps in the live demo, the Markdown view shows
 * the fence, and LaTeX renders the caption verbatim.
 */

export const PAPER_TITLE = "Writing together without taking turns";

export const PAPER_AUTHOR = "The Softmaple working group";

export const PAPER_SOURCE = `Most writing tools make collaboration a matter of turns. Someone has the file, or the lock, or the copy that everyone else is waiting on. The cost is not the merge conflict at the end. It is the sentence you did not write because it was not your turn.

Softmaple removes the turn. Two people can type inside the same sentence at the same moment and both edits survive, in the same order, on every screen — including the screens that were offline while it happened.

# Turn-taking is a storage decision, not a social one

A document held as a file has exactly one current version, so somebody has to be holding it. Every convention built on top of that — checking out, locking, “are you in this yet?”, passing a draft back and forth over email — exists to decide whose turn it is.

That constraint is not about writing. It is about how the writing is stored.

\`\`\`figure:presence
Figure 1. Two writers inside one sentence. Neither one is waiting.
\`\`\`

# A document is a history, not a file

Softmaple does not keep your document. It keeps everything that has happened to it: each insertion, each deletion, each one stamped with who made it and what they had already seen.

The text you are reading is what you get when that history is replayed. Two people editing at once produce two branches of the same history, and replaying them always lands on the same text — in any order, on any machine, however late an edit arrives.

That is why closing your laptop mid-sentence is not an edge case. Your edits wait on your own machine and rejoin the history when you do. Nothing is **merged**, because nothing ever forked into a rival copy.

\`\`\`figure:convergence
Figure 2. Two writers and one reconnection, converging on one text.
\`\`\`

# Four ways to read the same history

Rich text while you write. A typeset page while you read. Markdown when you need to paste it somewhere else. LaTeX when a journal asks.

These are not four export formats sitting behind a menu. They are four renderings of one history, and you can switch between them without the document changing underneath you.

> The LaTeX view of this page is not a screenshot. It is this document, put through the converter that ships inside the editor.

# What you actually get

- A workspace, and the people you write with in it
- Documents that survive a closed laptop and a bad connection
- A read-only link when a draft is ready to be seen, revocable at any time
- Markdown in, LaTeX out, with no conversion step you have to think about
`;
