import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { demos } from "@/lib/demos";

const spring = { type: "spring" as const, stiffness: 380, damping: 32 };

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const isLexicalCollaborationCanvas = pathname === "/demo/lexical-eg-walker";
  const isHome = pathname === "/";

  if (isLexicalCollaborationCanvas) return null;

  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur-xl ${
        isHome
          ? "border-transparent bg-[var(--pg-paper)]/55"
          : "border-[var(--pg-line)] bg-[var(--pg-paper)]/80"
      }`}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <Link
          to="/"
          className="pg-focus-ring rounded-sm font-[family-name:var(--font-display)] text-lg font-bold tracking-[-0.03em] text-[var(--pg-ink)] active:translate-y-px"
        >
          SoftMaple
          <span className="ml-1.5 font-normal text-[var(--pg-ink-muted)]">
            Playground
          </span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {isHome ? (
            <button
              type="button"
              className="pg-focus-ring rounded-sm px-1 py-2 text-sm text-[var(--pg-ink-muted)] transition-colors hover:text-[var(--pg-ink)] active:translate-y-px"
              onClick={() => {
                document.getElementById("demos")?.scrollIntoView({
                  behavior: reduceMotion ? "auto" : "smooth",
                });
              }}
            >
              Demos
            </button>
          ) : (
            <Link
              to="/"
              hash="demos"
              className="pg-focus-ring rounded-sm px-1 py-2 text-sm text-[var(--pg-ink-muted)] transition-colors hover:text-[var(--pg-ink)] active:translate-y-px"
            >
              Demos
            </Link>
          )}
          <a
            href="https://docs.softmaple.ink"
            target="_blank"
            rel="noopener noreferrer"
            className="pg-focus-ring rounded-sm px-1 py-2 text-sm text-[var(--pg-ink-muted)] transition-colors hover:text-[var(--pg-ink)] active:translate-y-px"
          >
            Docs
          </a>
          {!isHome ? (
            <Link
              to="/demo/lexical-eg-walker"
              className="pg-focus-ring bg-[var(--pg-ink)] px-3.5 py-2 text-sm font-medium text-[var(--pg-paper)] transition-opacity hover:opacity-90 active:translate-y-px"
            >
              Open Lexical demo
            </Link>
          ) : null}
        </nav>

        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className="pg-focus-ring min-h-11 min-w-11 rounded-sm p-2 text-[var(--pg-ink)] transition-colors hover:bg-[var(--pg-elevated)] active:translate-y-px md:hidden"
              aria-label="Open menu"
            >
              <Menu size={22} />
            </button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-[min(100%,20rem)] gap-0 border-[var(--pg-line)] bg-[var(--pg-surface)] p-0 text-[var(--pg-ink)] sm:max-w-xs"
          >
            <SheetHeader className="border-b border-[var(--pg-line)] px-4 py-3">
              <SheetTitle className="font-[family-name:var(--font-display)] font-semibold tracking-[-0.02em] text-[var(--pg-ink)]">
                Navigate
              </SheetTitle>
              <SheetDescription className="sr-only">
                Browse Playground demos and documentation.
              </SheetDescription>
            </SheetHeader>

            <nav className="flex-1 overflow-y-auto p-4">
              <motion.div
                initial={reduceMotion ? false : "hidden"}
                animate="show"
                variants={{
                  hidden: {},
                  show: {
                    transition: { staggerChildren: reduceMotion ? 0 : 0.04 },
                  },
                }}
              >
                <motion.div
                  variants={{
                    hidden: { opacity: 0, x: 12 },
                    show: { opacity: 1, x: 0, transition: spring },
                  }}
                >
                  <SheetClose asChild>
                    <Link
                      to="/"
                      className="pg-focus-ring mb-1 block rounded-sm px-3 py-2.5 text-sm font-medium hover:bg-[var(--pg-elevated)] active:translate-y-px"
                    >
                      Home
                    </Link>
                  </SheetClose>
                </motion.div>
                {demos.map((demo) => (
                  <motion.div
                    key={demo.id}
                    variants={{
                      hidden: { opacity: 0, x: 12 },
                      show: { opacity: 1, x: 0, transition: spring },
                    }}
                  >
                    <SheetClose asChild>
                      <Link
                        to={demo.link}
                        className="pg-focus-ring mb-1 block rounded-sm px-3 py-2.5 text-sm hover:bg-[var(--pg-elevated)] active:translate-y-px"
                      >
                        <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--pg-ink-muted)]">
                          {demo.id}
                        </span>
                        <span className="mt-0.5 block font-medium">
                          {demo.title}
                        </span>
                      </Link>
                    </SheetClose>
                  </motion.div>
                ))}
                <motion.div
                  variants={{
                    hidden: { opacity: 0, x: 12 },
                    show: { opacity: 1, x: 0, transition: spring },
                  }}
                >
                  <SheetClose asChild>
                    <a
                      href="https://docs.softmaple.ink"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pg-focus-ring mt-4 block rounded-sm border border-[var(--pg-line)] px-3 py-2.5 text-sm font-medium hover:border-[var(--pg-ink-muted)] hover:bg-[var(--pg-elevated)] active:translate-y-px"
                    >
                      Documentation
                    </a>
                  </SheetClose>
                </motion.div>
              </motion.div>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
