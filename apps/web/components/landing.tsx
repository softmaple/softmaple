import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  Circle,
  FileCode2,
  Github,
  Radio,
  Users,
} from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { ModeToggle } from "@/components/mode-toggle";
import { SITE_CONFIG } from "@softmaple/config";

const FEATURES = [
  {
    index: "01",
    title: "Durable collaboration",
    body: "Concurrent rich-text edits are persisted as event batches, acknowledged, repaired after reconnect, and replayed into the same document state.",
  },
  {
    index: "02",
    title: "Presence with real identity",
    body: "Workspace members see who is here, across tabs, with profile-backed names and ephemeral cursor state that never pollutes the database.",
  },
  {
    index: "03",
    title: "One source, four views",
    body: "Edit visually, then inspect live Preview, Markdown, or a complete LaTeX document—all derived from the current collaborative editor state.",
  },
  {
    index: "04",
    title: "Controlled public sharing",
    body: "Owners can issue a stable, unlisted read-only link and revoke it without exposing workspace membership or export controls.",
  },
] as const;

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-5 px-4 sm:px-6">
          <Link
            className="font-display text-lg font-bold tracking-tight"
            href="/"
          >
            softmaple<span className="text-primary">.</span>
          </Link>
          <nav className="ml-auto hidden items-center gap-5 font-mono text-[11px] sm:flex">
            <a href={SITE_CONFIG.PLAYGROUND}>Playground</a>
            <a href={SITE_CONFIG.DOCS}>Docs</a>
            <a href={SITE_CONFIG.GITHUB_REPO}>GitHub</a>
          </nav>
          <ModeToggle />
          <Button
            asChild
            className="hidden sm:inline-flex"
            size="sm"
            variant="ghost"
          >
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/signup">Start writing</Link>
          </Button>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl border-x lg:grid-cols-[1.08fr_0.92fr]">
          <div className="relative min-h-[34rem] border-b p-6 sm:p-10 lg:border-b-0 lg:border-r lg:p-16">
            <div className="absolute left-0 top-10 h-px w-10 bg-primary sm:w-16" />
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-primary">
              Collaborative document infrastructure
            </p>
            <h1 className="mt-12 max-w-3xl font-display text-[clamp(3rem,8vw,6.6rem)] font-semibold leading-[0.9] tracking-[-0.055em]">
              Ideas move.
              <br />
              The record
              <br />
              holds.
            </h1>
            <p className="mt-10 max-w-xl text-base leading-7 text-muted-foreground sm:ml-20">
              Softmaple is a high-density workspace for durable collaborative
              writing, live presence, Markdown and LaTeX output, and deliberate
              public sharing.
            </p>
            <div className="mt-9 flex flex-wrap gap-3 sm:ml-20">
              <Button asChild size="lg">
                <Link href="/signup">
                  Create a workspace <ArrowUpRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={SITE_CONFIG.PLAYGROUND}>Open playground</a>
              </Button>
            </div>
          </div>

          <div className="flex min-h-[34rem] flex-col justify-center bg-card/70 p-4 sm:p-8 lg:p-10">
            <div className="border bg-background shadow-[0_24px_80px_-48px_rgba(201,24,74,0.7)]">
              <div className="flex items-center gap-2 border-b px-3 py-2 font-mono text-[10px] text-muted-foreground">
                <Circle className="size-2.5 fill-primary text-primary" />
                field-notes / carbon-cycle
                <span className="ml-auto flex items-center gap-1 text-teal-600 dark:text-teal-400">
                  <Check className="size-3" /> Saved
                </span>
              </div>
              <div className="grid grid-cols-[2.6rem_1fr]">
                <div className="border-r py-6 text-center font-mono text-[10px] leading-7 text-muted-foreground">
                  01
                  <br />
                  02
                  <br />
                  03
                  <br />
                  04
                  <br />
                  05
                  <br />
                  06
                </div>
                <div className="relative px-5 py-6 sm:px-7">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">
                    Observation / 09:42
                  </p>
                  <h2 className="mt-4 font-display text-2xl font-semibold">
                    A shared record of change
                  </h2>
                  <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">
                    Each insertion becomes a durable event. When Lina
                    reconnects, repair resumes after the last acknowledged
                    cursor—without overwriting Marco’s concurrent paragraph.
                  </p>
                  <blockquote className="mt-5 border-l-2 border-primary pl-4 text-sm italic">
                    The document converges; the writers keep their context.
                  </blockquote>
                  <span className="absolute right-12 top-32 h-5 border-l-2 border-teal-500" />
                  <span className="absolute right-3 top-[8.1rem] bg-teal-600 px-1.5 py-0.5 font-mono text-[9px] text-white">
                    Lina
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t px-3 py-2 font-mono text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Radio className="size-3 text-primary" /> 3 active
                </span>
                <span className="flex items-center gap-1.5">
                  <FileCode2 className="size-3" /> Markdown / LaTeX
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  <Users className="size-3" /> Owner · 2 editors
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl border-x border-t">
          <div className="grid lg:grid-cols-[18rem_1fr]">
            <div className="border-b p-6 lg:border-b-0 lg:border-r lg:p-9">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
                Product surface
              </p>
              <h2 className="mt-4 font-display text-3xl font-semibold">
                Focused on the work that exists today.
              </h2>
            </div>
            <div className="grid sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <article
                  className="min-h-56 border-b p-6 odd:sm:border-r last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0 sm:p-8"
                  key={feature.index}
                >
                  <span className="font-mono text-[10px] text-primary">
                    {feature.index}
                  </span>
                  <h3 className="mt-8 font-display text-xl font-semibold">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    {feature.body}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl border-x border-t px-6 py-16 sm:px-10 sm:py-24">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-primary">
            Ready when the document is
          </p>
          <div className="mt-5 flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
            <h2 className="max-w-3xl font-display text-4xl font-semibold leading-none sm:text-6xl">
              Start a workspace. Write the first durable line.
            </h2>
            <Button asChild size="lg">
              <Link href="/signup">Create your account</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 font-mono text-[10px] text-muted-foreground sm:flex-row sm:items-center sm:px-6">
          <span>© {new Date().getFullYear()} Softmaple</span>
          <div className="flex flex-wrap gap-5 sm:ml-auto">
            <a href={SITE_CONFIG.DOCS}>Docs</a>
            <a
              href={SITE_CONFIG.GITHUB_REPO}
              className="flex items-center gap-1"
            >
              <Github className="size-3" /> GitHub
            </a>
            <a href={SITE_CONFIG.TWITTER}>X</a>
            <a href={`mailto:${SITE_CONFIG.CONTACT_EMAIL}`}>Email</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
