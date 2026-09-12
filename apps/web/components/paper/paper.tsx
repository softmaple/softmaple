"use client";

import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRight, Check, Code, Eye, FileText, Menu } from "lucide-react";
import { markdownToLatex } from "@softmaple/md2latex";
import { Button } from "@softmaple/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import { SITE_CONFIG } from "@softmaple/config";
import { SoftmapleWordmark } from "@/components/BrandMark";
import { ModeToggle } from "@/components/mode-toggle";
import { FIGURES } from "@/components/paper/paper-figures";
import { toSourceLines } from "@/components/paper/paper-lines";
import { splitFigures } from "@/components/paper/paper-segments";
import {
  PAPER_AUTHOR,
  PAPER_SOURCE,
  PAPER_TITLE,
} from "@/components/paper/paper-source";

/**
 * The landing page is a Softmaple document.
 *
 * Not a page about the product — a working paper written in it, with the
 * product's own chrome above it and its own three views of itself. The Read
 * view renders `PAPER_SOURCE`; the Markdown view is that same string; the
 * LaTeX view is `markdownToLatex()` from `@softmaple/md2latex`, the converter
 * the editor ships with, run over it. Switching views here is the demo.
 */

const PAPER_VIEW = {
  Read: "read",
  Markdown: "markdown",
  Latex: "latex",
} as const;

type PaperView = (typeof PAPER_VIEW)[keyof typeof PAPER_VIEW];

const VIEW_OPTIONS = [
  { icon: Eye, label: "Read", value: PAPER_VIEW.Read },
  { icon: FileText, label: "Markdown", value: PAPER_VIEW.Markdown },
  { icon: Code, label: "LaTeX", value: PAPER_VIEW.Latex },
] as const;

const NAV_LINKS = [
  { href: SITE_CONFIG.PLAYGROUND, label: "Playground" },
  { href: SITE_CONFIG.DOCS, label: "Docs" },
  { href: SITE_CONFIG.GITHUB_REPO, label: "GitHub" },
] as const;

/**
 * A co-author's comments. They are deliberately not in `PAPER_SOURCE`: a
 * comment is an annotation on a document, not part of its text, so it appears
 * beside the Read view and is absent from the Markdown and LaTeX — exactly
 * where it would be in the product.
 */
const MARGIN_NOTES: Readonly<Record<number, string>> = {
  0: "I'd cut “social”. The whole point is that it's a storage problem.",
  2: "This is the paragraph to lead with, I think.",
};

const MarginNote = ({ children }: { readonly children: ReactNode }) => (
  <aside className="paper-note">
    <span className="paper-note-author">Lina</span>
    {children}
  </aside>
);

const markdownComponents = {
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a className="paper-link" href={href}>
      {children}
    </a>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="paper-quote">{children}</blockquote>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <code className="paper-code">{children}</code>
  ),
  // The page's own `h1` is the paper's title, so the source's top-level
  // headings are its sections — `h2` in the page outline, `\section` in LaTeX.
  h1: ({ children }: { children?: ReactNode }) => (
    <h2 className="paper-section">
      <span className="paper-section-text">{children}</span>
    </h2>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="paper-item">{children}</li>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="paper-p">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="paper-list">{children}</ul>
  ),
};

const ReadView = () => {
  const segments = useMemo(() => splitFigures(PAPER_SOURCE), []);
  return (
    <>
      {segments.map((segment, index) => {
        const note = MARGIN_NOTES[index];
        if (segment.kind === "figure") {
          const Figure = FIGURES[segment.id];
          return (
            <figure className="paper-figure" key={`figure-${segment.id}`}>
              {Figure === undefined ? null : <Figure />}
              <figcaption className="paper-caption">
                {segment.caption}
              </figcaption>
            </figure>
          );
        }
        return (
          // A fragment, not a wrapper: every block has to be a direct child of
          // `.paper` so the grid can place it in the gutter, the measure, or
          // the margin.
          <Fragment key={`prose-${index}`}>
            <ReactMarkdown
              components={markdownComponents}
              remarkPlugins={[remarkGfm]}
              skipHtml
            >
              {segment.markdown}
            </ReactMarkdown>
            {note === undefined ? null : <MarginNote>{note}</MarginNote>}
          </Fragment>
        );
      })}
    </>
  );
};

const SourceView = ({
  source,
  syntax,
}: {
  readonly source: string;
  readonly syntax: "markdown" | "latex";
}) => (
  <ol className="paper-source">
    {toSourceLines(source, syntax).map((line, index) => (
      <li className="paper-source-line" data-tone={line.tone} key={index}>
        <span className="paper-source-number">{index + 1}</span>
        <code>{line.text === "" ? " " : line.text}</code>
      </li>
    ))}
  </ol>
);

export const Paper = () => {
  const [view, setView] = useState<PaperView>(PAPER_VIEW.Read);
  const [navOpen, setNavOpen] = useState(false);

  // The sheet trigger is hidden from `md` up, so a sheet left open across a
  // resize would be stranded with no way to dismiss it by pointer.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setNavOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  // The converter only runs when a reader actually asks for LaTeX.
  const latex = useMemo(
    () =>
      view === PAPER_VIEW.Latex
        ? markdownToLatex(PAPER_SOURCE, {
            author: PAPER_AUTHOR,
            title: PAPER_TITLE,
          })
        : "",
    [view],
  );

  return (
    <>
      <header className="doc-bar">
        <div className="doc-bar-inner">
          <Link
            aria-label="Softmaple home"
            className="shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            href="/"
          >
            <SoftmapleWordmark className="text-lg" />
          </Link>

          <span aria-hidden="true" className="doc-bar-rule" />

          <span className="doc-bar-file">
            <span className="truncate">why-softmaple.md</span>
            <span className="doc-bar-saved">
              <Check className="size-3" /> Saved
            </span>
          </span>

          <div
            aria-label="Document view"
            className="segmented ml-auto"
            role="radiogroup"
          >
            {VIEW_OPTIONS.map(({ icon: Icon, label, value }) => (
              <button
                aria-checked={value === view}
                className="segmented-option"
                key={value}
                onClick={() => setView(value)}
                role="radio"
                tabIndex={value === view ? 0 : -1}
                type="button"
              >
                <Icon aria-hidden="true" className="size-3.5" />
                <span className="hidden sm:inline">{label}</span>
                <span className="sr-only sm:hidden">{label}</span>
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <ModeToggle />
            <Button asChild className="hidden md:inline-flex" variant="ghost">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild className="hidden md:inline-flex">
              <Link href="/signup">
                Start writing <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Sheet onOpenChange={setNavOpen} open={navOpen}>
              <SheetTrigger asChild>
                <Button
                  aria-label="Open navigation"
                  className="md:hidden"
                  size="icon"
                  variant="outline"
                >
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent className="gap-0" side="bottom">
                <SheetHeader className="pb-2">
                  <SheetTitle>
                    <SoftmapleWordmark className="text-xl" />
                  </SheetTitle>
                  <SheetDescription>
                    A workspace where a document is a history.
                  </SheetDescription>
                </SheetHeader>
                <nav
                  aria-label="Mobile navigation"
                  className="flex flex-col gap-1 px-4"
                >
                  {NAV_LINKS.map((link) => (
                    <Button
                      asChild
                      className="h-11 justify-start px-3 text-base"
                      key={link.label}
                      variant="ghost"
                    >
                      <a href={link.href} onClick={() => setNavOpen(false)}>
                        {link.label}
                      </a>
                    </Button>
                  ))}
                </nav>
                <div className="mt-4 flex flex-col gap-3 border-t p-4">
                  <Button asChild size="lg">
                    <Link href="/signup" onClick={() => setNavOpen(false)}>
                      Start writing <ArrowRight data-icon="inline-end" />
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="outline">
                    <Link href="/login" onClick={() => setNavOpen(false)}>
                      Sign in
                    </Link>
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="paper" id="main">
        <div className="paper-masthead">
          <p className="eyebrow eyebrow-maple">Softmaple · working paper</p>
          <h1 className="paper-title">{PAPER_TITLE}</h1>
          <p className="paper-byline">
            {PAPER_AUTHOR} · revision 1.3 · open in the editor
          </p>
        </div>

        {/* Remounting on the view swap replays the entrance; see design.css. */}
        <div className="paper-body" key={view}>
          {view === PAPER_VIEW.Read ? <ReadView /> : null}
          {view === PAPER_VIEW.Markdown ? (
            <SourceView source={PAPER_SOURCE} syntax="markdown" />
          ) : null}
          {view === PAPER_VIEW.Latex ? (
            <SourceView source={latex} syntax="latex" />
          ) : null}
        </div>

        <div className="paper-end">
          <p className="paper-end-line">
            Open a workspace and start the history.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/signup">
                Start writing <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={SITE_CONFIG.PLAYGROUND}>Try it in two windows</a>
            </Button>
          </div>
          <p className="paper-end-note">
            Free while Softmaple is in beta. No card, no seat count.
          </p>
        </div>
      </main>
    </>
  );
};
