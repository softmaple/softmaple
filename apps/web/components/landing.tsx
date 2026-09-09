import Link from "next/link";
import { ArrowUpRight, FileCode2, Link2, Users } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { SITE_CONFIG } from "@softmaple/config";
import { SiteHeader } from "@/components/site-header";
import { SoftmapleWordmark } from "@/components/BrandMark";
import { CollaborationDemo } from "./collaboration-demo";

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-workspace text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:bg-surface focus:p-4"
        href="#main"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-7xl px-5 sm:px-8">
        <section className="grid gap-8 pb-12 pt-16 lg:grid-cols-[1.4fr_0.6fr] lg:items-end lg:pb-16 lg:pt-24">
          <div>
            <p className="mb-7 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[.2em]">
              <span className="h-2 w-8 bg-primary" />
              Thinking is better in good company
            </p>
            <h1 className="font-display text-[clamp(3.5rem,8vw,7.5rem)] font-semibold leading-[.98] tracking-[-.06em]">
              Make room
              <br />
              for <span className="text-emphasis">together.</span>
            </h1>
          </div>
          <div className="pb-1">
            <p className="max-w-sm text-lg leading-8 text-muted-foreground">
              Your own place to write. A shared place to think. Bring people
              into the passage, then find your way back.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/signup">
                  Start writing <ArrowUpRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
            <p className="mt-5 font-mono text-[10px] text-muted-foreground">
              RICH TEXT / MARKDOWN / LATEX
            </p>
          </div>
        </section>
        <CollaborationDemo />
        <section
          className="grid gap-8 py-16 md:grid-cols-3 lg:gap-12 lg:py-24"
          aria-label="Made for working together"
        >
          {[
            {
              icon: Users,
              title: "Presence with a purpose",
              body: "See who is here, invite their attention, and work beside them. Quiet when you need to concentrate.",
            },
            {
              icon: FileCode2,
              title: "One idea. Every format.",
              body: "Write in rich text, check the preview, and export Markdown or LaTeX from the same document.",
            },
            {
              icon: Link2,
              title: "An open door you control",
              body: "Enable a public read-only link to start live collaboration with workspace members. Turn the link off when you're done.",
            },
          ].map(({ icon: Icon, title, body }, index) => (
            <article key={title} className="border-t pt-5">
              <div className="mb-8 flex items-center justify-between">
                <Icon size={20} className="text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">
                  0{index + 1}
                </span>
              </div>
              <h2 className="text-xl font-medium tracking-tight">{title}</h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                {body}
              </p>
            </article>
          ))}
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-5 py-8 sm:px-8">
          <SoftmapleWordmark className="text-xl" />
          <p className="text-xs text-muted-foreground">
            A little shared attention goes a long way.
          </p>
          <div className="flex gap-5 text-xs">
            <a href={SITE_CONFIG.DOCS}>Documentation</a>
            <a href={SITE_CONFIG.GITHUB_REPO}>GitHub</a>
            <a href={SITE_CONFIG.PLAYGROUND}>Editor playground</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
