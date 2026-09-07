import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileCode2,
  FileText,
  Link2,
  Users,
  PenLine,
} from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { Badge } from "@softmaple/ui/components/badge";
import { Separator } from "@softmaple/ui/components/separator";
import { SITE_CONFIG } from "@softmaple/config";
import { SiteHeader } from "@/components/site-header";
import { SoftmapleWordmark } from "@/components/BrandMark";

const features = [
  {
    icon: Users,
    title: "Good ideas have company.",
    body: "Write together in the same document. See who’s here and pick up where you left off, even after reconnecting.",
    label: "Made for collaboration",
  },
  {
    icon: FileCode2,
    title: "Your words. More possibilities.",
    body: "Move between rich text, Preview, Markdown, and LaTeX. Keep your attention on the idea while the format falls into place.",
    label: "One document, four views",
  },
  {
    icon: Link2,
    title: "Share when you’re ready.",
    body: "Give your work a read-only public link. Keep editing in your workspace, and turn off the link whenever you need to.",
    label: "Sharing on your terms",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:bg-card focus:p-4"
        href="#main"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[0.95fr_1.05fr] lg:gap-10 lg:py-24">
          <div>
            <Badge variant="secondary">
              <PenLine data-icon="inline-start" /> A shared space for your words
            </Badge>
            <h1 className="mt-7 font-display text-[clamp(3.25rem,6.6vw,6rem)] font-semibold leading-[1.02] tracking-[-0.065em]">
              A little space.
              <br />
              For <span className="text-primary">big ideas.</span>
            </h1>
            <p className="mt-7 max-w-md text-lg leading-8 text-muted-foreground">
              From the first rough note to the final paper. Write, shape, and
              share your thinking, together.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/signup">
                  Start writing <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={SITE_CONFIG.PLAYGROUND}>
                  Explore the editor <ArrowUpRight data-icon="inline-end" />
                </a>
              </Button>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              Rich text. Markdown. LaTeX. Room to think.
            </p>
          </div>
          <div
            className="manuscript-stage"
            aria-label="Example of a shared Softmaple document"
          >
            <div className="manuscript-sheet">
              <div className="flex items-center gap-2 border-b px-5 py-4 text-xs text-muted-foreground">
                <FileText className="size-4 text-primary" />
                <span className="truncate">
                  Field notes / A slower kind of progress
                </span>
                <Check className="ml-auto size-4 shrink-0 text-primary" />
                <span className="hidden sm:inline">Saved</span>
              </div>
              <div className="px-6 py-9 sm:px-10 sm:py-12">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Field notes · Working draft
                </p>
                <h2 className="mt-5 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                  A slower kind
                  <br />
                  of progress
                </h2>
                <p className="mt-6 text-sm leading-7 text-muted-foreground">
                  What if the most useful thing we could make was a little more
                  room to think?
                </p>
                <p className="mt-4 text-sm leading-7">
                  A place for unfinished sentences.
                  <br />
                  For questions worth sitting with.
                  <br />
                  <span className="bg-accent text-accent-foreground">
                    For ideas that get better together.
                  </span>
                </p>
                <Separator className="my-7" />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="grid size-7 place-items-center rounded-full bg-secondary text-primary">
                    L
                  </span>
                  <span>Lina is writing…</span>
                  <PenLine className="ml-auto size-4 text-primary" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 border-t px-5 py-3 text-[11px] text-muted-foreground">
                <span className="font-medium text-primary">Rich text</span>
                <span>Preview</span>
                <span>Markdown</span>
                <span>LaTeX</span>
              </div>
            </div>
            <div className="manuscript-note">
              <Users className="size-4" />
              <span>A shared thought starts here.</span>
            </div>
          </div>
        </section>
        <section
          className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 lg:pb-28"
          aria-labelledby="features-heading"
        >
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2
              id="features-heading"
              className="max-w-lg font-display text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              Less between you
              <br />
              and the next sentence.
            </h2>
            <p className="max-w-xs text-sm leading-6 text-muted-foreground">
              A focused toolkit for the way ideas actually take shape.
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {features.map(({ icon: Icon, ...feature }) => (
              <article
                className="rounded-2xl border bg-card p-7"
                key={feature.title}
              >
                <div className="mb-8 flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary">
                    <Icon className="size-5" />
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {feature.label}
                  </p>
                </div>
                <h3 className="font-display text-xl font-semibold tracking-tight">
                  {feature.title}
                </h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  {feature.body}
                </p>
              </article>
            ))}
          </div>
        </section>
        <section className="bg-secondary px-5 py-16 text-center sm:px-8 sm:py-20">
          <p className="font-mono text-xs text-muted-foreground">
            THE NEXT PAGE IS YOURS
          </p>
          <h2 className="mt-5 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Make room for a new idea.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Open a workspace. Invite your people. Find your words.
          </p>
          <Button asChild className="mt-7" size="lg">
            <Link href="/signup">
              Create your workspace <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </section>
      </main>
      <footer className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-9 sm:flex-row sm:items-center sm:px-8">
        <Link href="/" aria-label="Softmaple home">
          <SoftmapleWordmark className="text-xl" />
        </Link>
        <span className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} Softmaple
        </span>
        <nav
          aria-label="Footer"
          className="flex flex-wrap gap-6 text-sm text-muted-foreground sm:ml-auto"
        >
          <a href={SITE_CONFIG.DOCS}>Docs</a>
          <a href={SITE_CONFIG.GITHUB_REPO}>GitHub</a>
          <a href={`mailto:${SITE_CONFIG.CONTACT_EMAIL}`}>
            Say hello <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </footer>
    </div>
  );
}
