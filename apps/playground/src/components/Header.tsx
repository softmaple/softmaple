import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
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
    <>
      <header
        className={`sticky top-0 z-40 border-b backdrop-blur-md ${
          isHome
            ? "border-transparent bg-[var(--pg-paper)]/70"
            : "border-[var(--pg-line)] bg-[var(--pg-paper)]/90"
        }`}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link
            to="/"
            className="font-[family-name:var(--font-display)] text-lg font-bold tracking-[-0.03em] text-[var(--pg-ink)]"
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
                className="text-sm text-[var(--pg-ink-muted)] transition-colors hover:text-[var(--pg-ink)]"
                onClick={() => {
                  document
                    .getElementById("demos")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                Demos
              </button>
            ) : (
              <Link
                to="/"
                hash="demos"
                className="text-sm text-[var(--pg-ink-muted)] transition-colors hover:text-[var(--pg-ink)]"
              >
                Demos
              </Link>
            )}
            <a
              href="https://docs.softmaple.ink"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--pg-ink-muted)] transition-colors hover:text-[var(--pg-ink)]"
            >
              Docs
            </a>
            {!isHome ? (
              <Link
                to="/demo/lexical-eg-walker"
                className="bg-[var(--pg-ink)] px-3.5 py-1.5 text-sm font-medium text-[var(--pg-paper)] transition-opacity hover:opacity-90"
              >
                Open Lexical demo
              </Link>
            ) : null}
          </nav>

          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="rounded-sm p-2 text-[var(--pg-ink)] transition-colors hover:bg-[var(--pg-ink)]/5 md:hidden"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {isOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="Close menu overlay"
              className="fixed inset-0 z-50 bg-[var(--pg-ink)]/30 md:hidden"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
              onClick={() => setIsOpen(false)}
            />
            <motion.aside
              className="fixed top-0 right-0 z-50 flex h-full w-[min(100%,20rem)] flex-col border-l border-[var(--pg-line)] bg-[var(--pg-paper)] text-[var(--pg-ink)] shadow-xl md:hidden"
              initial={reduceMotion ? false : { x: "100%" }}
              animate={{ x: 0 }}
              exit={reduceMotion ? undefined : { x: "100%" }}
              transition={spring}
            >
              <div className="flex items-center justify-between border-b border-[var(--pg-line)] px-4 py-3">
                <p className="font-[family-name:var(--font-display)] font-semibold tracking-[-0.02em]">
                  Navigate
                </p>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-sm p-2 hover:bg-[var(--pg-ink)]/5"
                  aria-label="Close menu"
                >
                  <X size={22} />
                </button>
              </div>

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
                    <Link
                      to="/"
                      onClick={() => setIsOpen(false)}
                      className="mb-1 block rounded-sm px-3 py-2.5 text-sm font-medium hover:bg-[var(--pg-ink)]/5"
                    >
                      Home
                    </Link>
                  </motion.div>
                  {demos.map((demo) => (
                    <motion.div
                      key={demo.id}
                      variants={{
                        hidden: { opacity: 0, x: 12 },
                        show: { opacity: 1, x: 0, transition: spring },
                      }}
                    >
                      <Link
                        to={demo.link}
                        onClick={() => setIsOpen(false)}
                        className="mb-1 block rounded-sm px-3 py-2.5 text-sm hover:bg-[var(--pg-ink)]/5"
                      >
                        <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--pg-ink-muted)]">
                          {demo.id}
                        </span>
                        <span className="mt-0.5 block font-medium">
                          {demo.title}
                        </span>
                      </Link>
                    </motion.div>
                  ))}
                  <motion.div
                    variants={{
                      hidden: { opacity: 0, x: 12 },
                      show: { opacity: 1, x: 0, transition: spring },
                    }}
                  >
                    <a
                      href="https://docs.softmaple.ink"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => setIsOpen(false)}
                      className="mt-4 block rounded-sm border border-[var(--pg-line)] px-3 py-2.5 text-sm font-medium"
                    >
                      Documentation
                    </a>
                  </motion.div>
                </motion.div>
              </nav>
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    </>
  );
}
