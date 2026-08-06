import { createFileRoute, Link } from "@tanstack/react-router";
import { DemoList } from "@/components/home/DemoList";
import { HomeHero } from "@/components/home/HomeHero";

export const Route = createFileRoute("/")({ component: App });

function App() {
  return (
    <main className="min-h-screen bg-[var(--pg-paper)] text-[var(--pg-ink)]">
      <HomeHero />
      <DemoList />
      <footer className="border-t border-[var(--pg-line)] px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-[-0.02em]">
            SoftMaple Playground
          </p>
          <div className="flex flex-wrap gap-5 text-sm text-[var(--pg-ink-muted)]">
            <a
              href="https://docs.softmaple.ink"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--pg-ink)]"
            >
              Docs
            </a>
            <a
              href="https://github.com/softmaple/softmaple"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[var(--pg-ink)]"
            >
              GitHub
            </a>
            <Link
              to="/demo/lexical-eg-walker"
              className="hover:text-[var(--pg-ink)]"
            >
              Lexical demo
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
