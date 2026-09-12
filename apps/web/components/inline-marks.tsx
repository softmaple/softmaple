import type { ComponentType, ReactNode } from "react";

/**
 * Inline marks for a sentence that annotates itself.
 *
 * Each mark is the thing its words describe: "highlight" wears a highlighter,
 * a shareable link gets a rule drawn under it, Markdown wears its own syntax,
 * and LaTeX typesets itself into the lockup every reader of this product
 * recognises. Nothing here is decoration — a mark is only ever used on the
 * word it is the mark for.
 *
 * The marks are drawn in reading order by a scroll-driven animation shared
 * across the whole paragraph; `step` is that order. Styling and timing live in
 * `app/design.css`. Without scroll timelines — or with reduced motion — every
 * mark simply renders finished.
 */

export type MarkProps = {
  readonly children: ReactNode;
  /** Position in the reading order, 1-5. Drives the stagger, not the styling. */
  readonly step: number;
};

/** A felt-tip swipe across a word. */
export const Swipe = ({ children, step }: MarkProps) => (
  <span className="mark mark-swipe" data-mark-step={step}>
    {children}
  </span>
);

export type RuleProps = MarkProps & {
  readonly icon: ComponentType<{ className?: string }>;
};

/** An icon standing in front of a phrase, with a rule drawn under it. */
export const Rule = ({ children, icon: Icon, step }: RuleProps) => (
  <span className="mark" data-mark-step={step}>
    <Icon aria-hidden="true" className="mark-icon" />
    <span className="mark mark-rule">{children}</span>
  </span>
);

/** A word wearing the Markdown that would emphasise it. */
export const Syntax = ({ children, step }: MarkProps) => (
  <span className="mark" data-mark-step={step}>
    <span aria-hidden="true" className="mark-syntax-token">
      **
    </span>
    {children}
    <span aria-hidden="true" className="mark-syntax-token">
      **
    </span>
  </span>
);

/**
 * The LaTeX lockup. The letters occupy their final positions from the start
 * and only slide into place, so the word never reflows around them — and it
 * still reads as plain "LaTeX" to a screen reader.
 */
export const Latex = ({ step }: { readonly step: number }) => (
  <span className="mark latex-lockup" data-mark-step={step}>
    L<span className="latex-a">a</span>T<span className="latex-e">e</span>X
  </span>
);
