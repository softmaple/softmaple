import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { demos } from "@/lib/demos";

const spring = { type: "spring" as const, stiffness: 320, damping: 30 };

export function DemoList() {
  const reduceMotion = useReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  const reveal = (index: number) =>
    !ready || reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-40px" },
          transition: { ...spring, delay: index * 0.04 },
        };

  return (
    <section id="demos" className="mx-auto max-w-6xl px-6 py-20 md:py-28">
      <div className="mb-12 max-w-2xl">
        <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] text-[var(--pg-ink)] md:text-4xl">
          Demos
        </h2>
        <p className="mt-3 text-base text-[var(--pg-ink-muted)] md:text-lg">
          Start with Lexical × EG-walker for cross-browser rich-text sync, or
          explore the other collaboration experiments below.
        </p>
      </div>

      <ul className="divide-y divide-[var(--pg-line)] border-y border-[var(--pg-line)]">
        {demos.map((demo, index) => (
          <motion.li key={demo.id} {...reveal(index)}>
            <Link
              to={demo.link}
              className="pg-focus-ring group relative flex flex-col gap-4 py-7 transition-[transform,color] active:translate-y-px md:flex-row md:items-start md:gap-8 md:py-9"
            >
              <span className="absolute inset-x-[-1rem] inset-y-0 -z-10 rounded-sm bg-[var(--pg-elevated)] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 md:inset-x-[-1.5rem]" />

              <span className="font-[family-name:var(--font-mono)] text-sm text-[var(--pg-ink-muted)] tabular-nums">
                {demo.id}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className="h-2 w-2 shrink-0 rounded-[1px]"
                    style={{ backgroundColor: demo.accent }}
                    aria-hidden
                  />
                  <h3 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-[-0.02em] text-[var(--pg-ink)] md:text-2xl">
                    {demo.title}
                  </h3>
                  {demo.badge ? (
                    <span className="font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-[var(--pg-ink-muted)] uppercase">
                      {demo.badge}
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--pg-ink-muted)] md:text-base">
                  {demo.description}
                </p>
              </div>

              <span
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center border border-[var(--pg-line)] text-[var(--pg-ink)] transition-all duration-200 group-hover:scale-105 group-hover:border-[var(--pg-ink)] group-hover:bg-[var(--pg-ink)] group-hover:text-[var(--pg-paper)] group-focus-visible:scale-105 group-focus-visible:border-[var(--pg-ink)] group-focus-visible:bg-[var(--pg-ink)] group-focus-visible:text-[var(--pg-paper)]"
                aria-hidden
              >
                <ArrowUpRight size={18} />
              </span>
            </Link>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
