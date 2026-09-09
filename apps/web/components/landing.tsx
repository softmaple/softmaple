import Link from "next/link";
import {
  ArrowRight,
  ArrowUp,
  AtSign,
  Check,
  Cloud,
  Image as ImageIcon,
  Laptop,
  Plus,
  Smartphone,
} from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { SITE_CONFIG } from "@softmaple/config";
import { SiteHeader } from "@/components/site-header";
import { SoftmapleLeaf, SoftmapleWordmark } from "@/components/BrandMark";
import { LandingAtmosphere } from "@/components/landing-atmosphere";
import { LandingWorkspacePreview } from "@/components/landing-workspace-preview";

const people = [
  { initial: "L", colour: "var(--person-violet)" },
  { initial: "K", colour: "var(--person-plum)" },
  { initial: "M", colour: "var(--person-teal)" },
];

const devices = [
  {
    icon: Smartphone,
    label: "A small idea for Saturday",
    when: "Edited just now",
  },
  { icon: Laptop, label: "A small idea for Saturday", when: "Edited 2m ago" },
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-workspace text-foreground">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-4"
        href="#main"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <section className="relative isolate overflow-hidden">
          <LandingAtmosphere />
          <div className="relative mx-auto grid max-w-7xl gap-12 px-5 pb-16 pt-14 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.04fr)] lg:items-center lg:gap-10 lg:pb-14 lg:pt-20">
            <div>
              <p className="mb-6 font-mono text-[10px] uppercase tracking-[.28em] text-muted-foreground">
                A place for shared thoughts
              </p>
              <h1 className="type-editorial text-[clamp(2.75rem,5.4vw,4.5rem)] leading-[1.02]">
                Your notes.
                <br />
                Better <span className="text-emphasis">together.</span>
              </h1>
              <p className="mt-7 max-w-[22rem] text-lg leading-8 text-muted-foreground">
                Capture a thought. Bring someone in. Make something of it.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link href="/signup">
                    Start writing <ArrowRight data-icon="inline-end" />
                  </Link>
                </Button>
              </div>
              <div className="mt-10 max-w-[17rem]">
                <p className="type-hand text-xl">
                  Good ideas go further together.
                </p>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 160 12"
                  className="mt-1 h-3 w-40 text-border"
                  fill="none"
                >
                  <path
                    d="M2 8.4c26-4.6 58-6.6 96-6 22 .4 40 2.2 54 5.4-18-1.2-36-1.8-54-1.8"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>

            <div>
              <LandingWorkspacePreview />
              <p className="type-hand mt-4 flex items-center justify-end gap-2 text-lg">
                <Check size={16} className="text-emphasis" />
                Same page, brighter together.
              </p>
            </div>
          </div>
        </section>

        <section
          className="mx-auto grid max-w-7xl gap-10 px-5 py-16 sm:px-8 md:grid-cols-3 lg:gap-12 lg:py-24"
          aria-label="How Softmaple works"
        >
          <article>
            <p className="font-mono text-xs text-emphasis">01</p>
            <h2 className="type-editorial mt-3 text-2xl">
              Capture the thought
            </h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              A clean, calm space to get ideas down before they slip away.
            </p>
            <div
              className="landing-paper mt-7 rounded-xl border bg-surface p-4"
              aria-hidden="true"
            >
              <p className="text-sm text-muted-foreground">
                What&rsquo;s on your mind?
              </p>
              <div className="mt-7 flex items-center gap-3 text-muted-foreground">
                <Plus size={15} />
                <ImageIcon size={15} />
                <AtSign size={15} />
                <span className="ml-auto flex items-center gap-2 text-xs">
                  Write
                  <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10px]">
                    ⌘K
                  </kbd>
                </span>
                <span className="grid size-6 place-items-center rounded-full border">
                  <ArrowUp size={12} />
                </span>
              </div>
            </div>
          </article>

          <article>
            <p className="font-mono text-xs text-emphasis">02</p>
            <h2 className="type-editorial mt-3 text-2xl">Think together</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              Write, react, and build on each other&rsquo;s ideas in real time.
            </p>
            <div
              className="landing-paper mt-7 rounded-xl border bg-surface p-4"
              aria-hidden="true"
            >
              <div className="flex items-center gap-3">
                <span className="flex -space-x-2">
                  {people.map((person) => (
                    <span
                      key={person.initial}
                      className="grid size-7 place-items-center rounded-full text-[11px] font-medium text-surface ring-2 ring-[var(--surface)]"
                      style={{ background: person.colour }}
                    >
                      {person.initial}
                    </span>
                  ))}
                </span>
                <span className="text-xs text-muted-foreground">3 here</span>
              </div>
              <div className="landing-chip mt-6 flex items-start gap-2 rounded-lg border bg-raised p-3">
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-medium text-surface"
                  style={{ background: "var(--person-plum)" }}
                >
                  K
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="text-xs font-medium">Kai</span>
                    <span className="text-[10px] text-muted-foreground">
                      2m ago
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    This makes it even better.
                  </span>
                </span>
              </div>
            </div>
          </article>

          <article>
            <p className="font-mono text-xs text-emphasis">03</p>
            <h2 className="type-editorial mt-3 text-2xl">Pick up anywhere</h2>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              Your notes stay in sync, on every device, whenever inspiration
              returns.
            </p>
            <div
              className="landing-paper mt-7 divide-y rounded-xl border bg-surface"
              aria-hidden="true"
            >
              {devices.map(({ icon: Icon, label, when }) => (
                <div key={when} className="flex items-center gap-3 p-3">
                  <Icon size={15} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">
                      {label}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {when}
                    </span>
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-3 p-3">
                <Cloud size={15} className="shrink-0 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  Synced across all your devices
                </span>
                <span className="ml-auto grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check size={12} />
                </span>
              </div>
            </div>
          </article>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-4 px-5 py-8 sm:px-8">
          <div className="flex items-center gap-2">
            <SoftmapleLeaf className="size-5" />
            <SoftmapleWordmark className="text-lg" />
          </div>
          <p className="text-xs text-muted-foreground">
            A little shared attention goes a long way.
          </p>
          <div className="ml-auto flex flex-wrap gap-5 text-xs text-muted-foreground">
            <a className="hover:text-foreground" href={SITE_CONFIG.DOCS}>
              Documentation
            </a>
            <a className="hover:text-foreground" href={SITE_CONFIG.GITHUB_REPO}>
              GitHub
            </a>
            <a className="hover:text-foreground" href={SITE_CONFIG.PLAYGROUND}>
              Editor playground
            </a>
            <a
              className="hover:text-foreground"
              href={`mailto:${SITE_CONFIG.CONTACT_EMAIL}`}
            >
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
