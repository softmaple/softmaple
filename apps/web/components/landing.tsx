import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CloudOff,
  FileCode2,
  Link2,
  Radio,
  Users,
} from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { SITE_CONFIG } from "@softmaple/config";
import { SiteHeader } from "@/components/site-header";
import { SoftmapleWordmark } from "@/components/BrandMark";

/**
 * The landing page is a document about a document editor, so it behaves like
 * one: paper, ink, a typeset measure, and scroll as the reading motion.
 *
 * Every animation on this page is CSS scroll-driven (see `app/design.css`),
 * which is why nothing here is a client component and the page ships no
 * JavaScript for its motion.
 */

/** Enter-animation ordering for the hero, which runs on load rather than scroll. */
const enterStep = (step: number): CSSProperties =>
  ({ "--enter-step": step }) as CSSProperties;

/** Mono lines are measured in `ch`, so the caret lands exactly on the last glyph. */
const lineLength = (characters: number): CSSProperties =>
  ({ "--line-length": `${characters}ch` }) as CSSProperties;

/** A writer's colour, worn by both their caret and the name flag riding it. */
const caretColor = (color: string): CSSProperties =>
  ({ "--caret-color": color }) as CSSProperties;

/** Syntax a human typed on purpose: Markdown markers, LaTeX control sequences. */
const Mark = ({ children }: { readonly children: ReactNode }) => (
  <span className="text-primary">{children}</span>
);

const SOURCE_LINES = ["01", "02", "03", "04", "05", "06", "07"] as const;

const Gutter = () => (
  <div
    aria-hidden="true"
    className="hidden shrink-0 flex-col border-r border-border px-3 py-5 text-right font-mono text-[10px] leading-[1.85] text-muted-foreground/70 sm:flex"
  >
    {SOURCE_LINES.map((line) => (
      <span key={line}>{line}</span>
    ))}
  </div>
);

type StageViewProps = {
  readonly children: ReactNode;
  readonly label: string;
  readonly note: string;
};

/**
 * One of the four ways to read the passage. The sheet chrome names the view,
 * so each panel stays self-describing when the stage falls back to a plain
 * vertical stack.
 */
const StageView = ({ children, label, note }: StageViewProps) => (
  <article className="stage-view sheet overflow-hidden">
    <div className="sheet-chrome">
      <span className="font-medium text-foreground">{label}</span>
      <span className="ml-auto truncate">{note}</span>
    </div>
    {children}
  </article>
);

const CAPABILITIES = [
  {
    body: "Edits from every writer land in the same order on every screen, so two people can work the same paragraph without stepping on each other.",
    icon: Users,
    label: "Shared editing",
    title: "Two people, one sentence.",
  },
  {
    body: "Close the laptop mid-thought. Your work is kept locally and replayed into the document the moment you are back on a network.",
    icon: CloudOff,
    label: "Offline drafts",
    title: "Leave, and pick it back up.",
  },
  {
    body: "Publish a read-only link when a draft is ready to be seen. Keep editing in your workspace, and switch the link off whenever you want it back.",
    icon: Link2,
    label: "Sharing",
    title: "Show it when you choose.",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:z-[60] focus:m-3 focus:rounded-sm focus:bg-card focus:px-4 focus:py-3 focus:shadow-lg"
        href="#main"
      >
        Skip to content
      </a>
      <SiteHeader />

      <main id="main">
        {/* ------------------------------------------------------------ hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-10 sm:px-8 sm:pb-28 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-16 lg:pb-32 lg:pt-16">
          <div className="min-w-0">
            <p
              className="eyebrow eyebrow-maple"
              data-enter
              style={enterStep(0)}
            >
              Rich text · Markdown · LaTeX
            </p>
            <h1
              className="mt-7 font-display text-[clamp(3.5rem,8.5vw,7rem)] font-semibold leading-[0.94] tracking-[-0.04em]"
              data-enter
              style={enterStep(1)}
            >
              A little space.
              <br />
              For <span className="text-primary">big ideas.</span>
            </h1>
            <p
              className="prose-editorial mt-8 max-w-[34ch] text-lg text-muted-foreground sm:text-xl"
              data-enter
              style={enterStep(2)}
            >
              From the first rough note to the typeset paper. Write together,
              read it four ways, and let the format fall into place.
            </p>
            <div
              className="mt-10 flex flex-wrap items-center gap-3"
              data-enter
              style={enterStep(3)}
            >
              <Button asChild size="lg">
                <Link href="/signup">
                  Start writing <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={SITE_CONFIG.PLAYGROUND}>
                  Open the playground <ArrowUpRight data-icon="inline-end" />
                </a>
              </Button>
            </div>
            <p
              className="mt-6 text-sm text-muted-foreground"
              data-enter
              style={enterStep(4)}
            >
              Free while Softmaple is in beta. No card, no seat count.
            </p>
          </div>

          <div className="min-w-0" data-drift>
            <div
              aria-label="A Softmaple document with two people writing in it"
              className="sheet mx-auto max-w-xl overflow-hidden"
              data-enter="sheet"
              role="img"
              style={enterStep(2)}
            >
              <div className="sheet-chrome">
                <span className="size-1.5 rounded-full bg-primary" />
                <span className="truncate">field-notes / carbon-cycle</span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-success">
                  <Check className="size-3" /> Saved
                </span>
              </div>
              <div className="px-6 py-9 sm:px-10 sm:py-12">
                <p className="eyebrow">Working draft · 09:42</p>
                <h2 className="mt-5 font-display text-3xl font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[2.6rem]">
                  A slower kind
                  <br />
                  of progress
                </h2>
                <p className="prose-editorial mt-6 text-[0.95rem] text-muted-foreground">
                  What if the most useful thing we could build was a little more
                  room to think?
                </p>
                <p className="prose-editorial mt-4 text-[0.95rem]">
                  A place for unfinished sentences. For questions worth sitting
                  with.{" "}
                  <span className="bg-accent px-0.5 text-accent-foreground">
                    For ideas that get better together.
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-4 border-t px-5 py-3 font-mono text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5 text-primary">
                  <Radio className="size-3" /> 2 writing
                </span>
                <span className="ml-auto hidden sm:inline">
                  Rich text · Preview · Markdown · LaTeX
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------- the four-view stage */}
        {/*
          The signature moment. One passage is held still on a pinned sheet
          while scrolling changes the clothing it wears. Where scroll timelines
          are unavailable — or the reader asked for no motion — this becomes an
          ordinary stack of four labelled sheets, which says the same thing.
        */}
        <section aria-labelledby="views-heading" className="bark-act">
          <div className="stage mx-auto max-w-7xl px-5 sm:px-8">
            <div className="stage-pin flex flex-col justify-center gap-10 py-20 lg:grid lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-center lg:gap-16 lg:py-0">
              <div className="min-w-0">
                <p className="eyebrow eyebrow-maple">One document</p>
                <h2
                  className="mt-6 font-display text-[clamp(2.25rem,4.6vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.035em]"
                  id="views-heading"
                >
                  Four ways to read
                  <br />
                  the same page.
                </h2>
                <p
                  className="prose-editorial mt-6 max-w-[38ch] text-base"
                  style={{ color: "var(--bark-muted)" }}
                >
                  You write once. Softmaple keeps the rich text, the reading
                  view, the Markdown, and the LaTeX in step — so handing a draft
                  to a journal is a choice of view, not a conversion.
                </p>
                <ol aria-hidden="true" className="stage-rail mt-10">
                  <li className="stage-rail-item">Rich text</li>
                  <li className="stage-rail-item">Preview</li>
                  <li className="stage-rail-item">Markdown</li>
                  <li className="stage-rail-item">LaTeX</li>
                </ol>
                <p
                  className="mt-8 hidden font-mono text-[11px] lg:block"
                  style={{ color: "var(--bark-muted)" }}
                >
                  Keep scrolling ↓
                </p>
              </div>

              <div className="stage-frame stage-views mt-10 min-w-0 lg:mt-0">
                <StageView label="Rich text" note="What you type">
                  <div className="px-6 py-7 sm:px-9 sm:py-9">
                    <h3 className="font-display text-2xl font-semibold tracking-[-0.02em]">
                      Carbon in the canopy
                    </h3>
                    <p className="prose-editorial mt-4 text-[0.95rem]">
                      A mature maple{" "}
                      <strong className="font-semibold">fixes</strong> roughly
                      22 kg of carbon a year — most of it in the eight weeks
                      either side of leaf-out.
                    </p>
                    <p className="mt-5 inline-flex items-center gap-2 rounded-sm border border-dashed px-2.5 py-1.5 font-mono text-xs text-muted-foreground">
                      <FileCode2 className="size-3.5 text-primary" />
                      C_t = C_0 e^(−kt)
                    </p>
                  </div>
                </StageView>

                <StageView label="Preview" note="What a reader sees">
                  <div className="px-6 py-7 sm:px-9 sm:py-9">
                    <p className="eyebrow">§ 2.1</p>
                    <h3 className="mt-3 font-display text-2xl font-semibold tracking-[-0.02em]">
                      Carbon in the canopy
                    </h3>
                    <p className="prose-editorial mt-4 text-[0.95rem]">
                      A mature maple{" "}
                      <strong className="font-semibold">fixes</strong> roughly
                      22 kg of carbon a year — most of it in the eight weeks
                      either side of leaf-out.
                    </p>
                    <p className="prose-editorial mt-6 text-center text-lg italic">
                      C<sub>t</sub> = C<sub>0</sub> e<sup>−kt</sup>
                      <span className="float-right not-italic text-sm text-muted-foreground">
                        (1)
                      </span>
                    </p>
                  </div>
                </StageView>

                <StageView label="Markdown" note="What you can paste anywhere">
                  <div className="flex">
                    <Gutter />
                    <pre className="min-w-0 overflow-x-auto px-4 py-5 font-mono text-[0.72rem] leading-[1.85] sm:px-6 sm:text-[0.8rem]">
                      <code>
                        <Mark>## </Mark>Carbon in the canopy{"\n"}
                        {"\n"}A mature maple <Mark>**</Mark>fixes<Mark>**</Mark>{" "}
                        roughly 22 kg of{"\n"}
                        carbon a year — most of it in the eight{"\n"}
                        weeks either side of leaf-out.{"\n"}
                        {"\n"}
                        <Mark>$$</Mark> C_t = C_0 e^{"{"}-kt{"}"}{" "}
                        <Mark>$$</Mark>
                      </code>
                    </pre>
                  </div>
                </StageView>

                <StageView label="LaTeX" note="What the journal wants">
                  <div className="flex">
                    <Gutter />
                    <pre className="min-w-0 overflow-x-auto px-4 py-5 font-mono text-[0.72rem] leading-[1.85] sm:px-6 sm:text-[0.8rem]">
                      <code>
                        <Mark>\section</Mark>
                        {"{Carbon in the canopy}"}
                        {"\n"}
                        {"\n"}A mature maple <Mark>\textbf</Mark>
                        {"{fixes}"} roughly{"\n"}
                        22 kg of carbon a year — most of it in{"\n"}
                        the eight weeks either side of leaf-out.{"\n"}
                        {"\n"}
                        <Mark>\begin</Mark>
                        {"{equation}"} C_t = C_0 e^{"{"}-kt{"}"}{" "}
                        <Mark>\end</Mark>
                        {"{equation}"}
                      </code>
                    </pre>
                  </div>
                </StageView>
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- presence */}
        <section
          aria-labelledby="presence-heading"
          className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20 lg:py-36"
        >
          <div className="min-w-0" data-reveal>
            <p className="eyebrow eyebrow-maple">Written together</p>
            <h2
              className="mt-6 font-display text-[clamp(2.25rem,4.6vw,3.75rem)] font-semibold leading-[1.02] tracking-[-0.035em]"
              id="presence-heading"
            >
              You can watch
              <br />a draft think.
            </h2>
            <p className="prose-editorial mt-6 max-w-[38ch] text-base text-muted-foreground">
              Carets carry names. Selections carry colours. Nobody has to
              announce that they are about to edit the third paragraph, because
              you can already see them in it.
            </p>
            <Button asChild className="mt-9" variant="outline">
              <a href={SITE_CONFIG.PLAYGROUND}>
                Try it with two windows <ArrowUpRight data-icon="inline-end" />
              </a>
            </Button>
          </div>

          <div
            aria-label="Two writers editing the same paragraph at once"
            className="sheet relative overflow-hidden"
            data-reveal
            role="img"
          >
            <div className="sheet-chrome">
              <span className="size-1.5 rounded-full bg-primary" />
              <span className="truncate">field-notes / carbon-cycle</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5">
                <Users className="size-3" /> 2 here
              </span>
            </div>
            <div className="px-5 py-9 font-mono text-[0.72rem] leading-[2.6] sm:px-9 sm:text-[0.82rem]">
              <p className="text-muted-foreground">## Carbon in the canopy</p>
              <p>
                <span
                  className="caret-line"
                  data-line="1"
                  style={{
                    ...lineLength(30),
                    ...caretColor("var(--success)"),
                  }}
                >
                  A mature maple fixes 22 kg of
                </span>
                <span
                  className="presence-flag"
                  style={{
                    ...caretColor("var(--success)"),
                    color: "var(--success-foreground)",
                  }}
                >
                  Lina
                </span>
              </p>
              <p>
                <span
                  className="caret-line"
                  data-caret
                  data-line="2"
                  style={lineLength(33)}
                >
                  carbon a year — most of it in the
                </span>
                <span
                  className="presence-flag"
                  style={{ color: "var(--primary-foreground)" }}
                >
                  You
                </span>
              </p>
            </div>
            <div className="flex items-center gap-4 border-t px-5 py-3 font-mono text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5 text-success">
                <Check className="size-3" /> All edits merged
              </span>
              <span className="ml-auto hidden sm:inline">
                No lock. No turns.
              </span>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------- capabilities */}
        <section
          aria-labelledby="capabilities-heading"
          className="border-t bg-secondary/40"
        >
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <h2
                className="max-w-[18ch] font-display text-[clamp(1.9rem,3.4vw,2.75rem)] font-semibold leading-[1.06] tracking-[-0.03em]"
                data-reveal="line"
                id="capabilities-heading"
              >
                Less between you and the next sentence.
              </h2>
              <p
                className="prose-editorial max-w-[30ch] text-sm text-muted-foreground"
                data-reveal="line"
              >
                The rest of the toolkit, kept deliberately small.
              </p>
            </div>

            <div className="mt-14 grid gap-px overflow-hidden rounded-sm border bg-border md:grid-cols-3">
              {CAPABILITIES.map(({ icon: Icon, ...capability }, index) => (
                <article
                  className="bg-card p-7 sm:p-9"
                  data-reveal
                  data-reveal-step={index + 1}
                  key={capability.title}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="size-4 text-primary" />
                    <p className="eyebrow">{capability.label}</p>
                  </div>
                  <h3 className="mt-10 font-display text-xl font-semibold tracking-[-0.02em]">
                    {capability.title}
                  </h3>
                  <p className="prose-editorial mt-3 text-sm text-muted-foreground">
                    {capability.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* --------------------------------------------------------- closing */}
        <section className="bark-act px-5 py-28 text-center sm:px-8 lg:py-40">
          <p className="eyebrow eyebrow-maple" data-reveal="line">
            The next page is yours
          </p>
          <h2
            className="mx-auto mt-8 max-w-[16ch] font-display text-[clamp(2.75rem,7vw,5.5rem)] font-semibold leading-[0.98] tracking-[-0.045em]"
            data-reveal="line"
          >
            Make room for a new idea.
          </h2>
          <p
            className="prose-editorial mx-auto mt-7 max-w-[42ch] text-base"
            data-reveal="line"
            style={{ color: "var(--bark-muted)" }}
          >
            Open a workspace, invite the people you write with, and find your
            words.
          </p>
          <div className="mt-11" data-reveal="line">
            <Button asChild size="lg">
              <Link href="/signup">
                Create your workspace <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:px-8">
          <Link
            aria-label="Softmaple home"
            className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            href="/"
          >
            <SoftmapleWordmark className="text-xl" />
          </Link>
          <span className="font-mono text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} Softmaple
          </span>
          <nav
            aria-label="Footer"
            className="flex flex-wrap gap-x-7 gap-y-2 text-sm text-muted-foreground sm:ml-auto"
          >
            <a
              className="stroke-link hover:text-foreground"
              href={SITE_CONFIG.DOCS}
            >
              Docs
            </a>
            <a
              className="stroke-link hover:text-foreground"
              href={SITE_CONFIG.GITHUB_REPO}
            >
              GitHub
            </a>
            <a
              className="stroke-link hover:text-foreground"
              href={`mailto:${SITE_CONFIG.CONTACT_EMAIL}`}
            >
              Say hello
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
