import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { experimentDemos, featuredDemo } from "@/lib/demos";

const spring = { type: "spring" as const, stiffness: 320, damping: 30 };

export function DemoList() {
  const reduceMotion = useReducedMotion();

  return (
    <section id="demos" className="mx-auto max-w-6xl px-6 py-16 md:py-24">
      <div className="mb-10 max-w-2xl">
        <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] text-[var(--pg-ink)] md:text-4xl">
          Demos
        </h2>
        <p className="mt-3 text-base text-[var(--pg-ink-muted)] md:text-lg">
          Lexical × EG-walker is the mainline collaboration lab. Everything else
          is a supporting experiment.
        </p>
      </div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={spring}
        className="mb-14"
      >
        <p className="mb-3 font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.18em] text-[var(--pg-accent)] uppercase">
          Featured
        </p>
        <Link
          to={featuredDemo.link}
          className="group relative block border border-[var(--pg-line)] bg-[var(--pg-surface)] p-6 transition-colors hover:border-[var(--pg-ink)] md:p-8"
          data-testid="featured-demo-card"
        >
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0 max-w-2xl">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0"
                  style={{ backgroundColor: featuredDemo.accent }}
                  aria-hidden
                />
                {featuredDemo.badge ? (
                  <span className="font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-[var(--pg-accent)] uppercase">
                    {featuredDemo.badge}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em] text-[var(--pg-ink)] md:text-3xl">
                {featuredDemo.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--pg-ink-muted)] md:text-base">
                {featuredDemo.description}
              </p>
              {featuredDemo.tags ? (
                <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-[family-name:var(--font-mono)] text-[11px] text-[var(--pg-ink-muted)]">
                  {featuredDemo.tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            <span className="inline-flex items-center gap-2 bg-[var(--pg-ink)] px-5 py-3 text-sm font-semibold text-[var(--pg-paper)] transition-transform group-hover:-translate-y-0.5">
              Open room
              <ArrowUpRight size={16} aria-hidden />
            </span>
          </div>
        </Link>
      </motion.div>

      <div>
        <p className="mb-3 font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.18em] text-[var(--pg-ink-muted)] uppercase">
          Experiments
        </p>
        <ul className="divide-y divide-[var(--pg-line)] border-y border-[var(--pg-line)]">
          {experimentDemos.map((demo, index) => (
            <motion.li
              key={demo.id}
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ ...spring, delay: index * 0.04 }}
            >
              <Link
                to={demo.link}
                className="group relative flex flex-col gap-3 py-5 transition-colors md:flex-row md:items-start md:gap-8 md:py-6"
              >
                <span className="absolute inset-x-[-1rem] inset-y-0 -z-10 bg-[var(--pg-surface)] opacity-0 transition-opacity duration-200 group-hover:opacity-100 md:inset-x-[-1.5rem]" />

                <span className="font-[family-name:var(--font-mono)] text-sm text-[var(--pg-ink-muted)] tabular-nums">
                  {demo.id}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className="h-2 w-2 shrink-0"
                      style={{ backgroundColor: demo.accent }}
                      aria-hidden
                    />
                    <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-[-0.02em] text-[var(--pg-ink)] md:text-xl">
                      {demo.title}
                    </h3>
                    {demo.badge ? (
                      <span className="font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-[var(--pg-ink-muted)] uppercase">
                        {demo.badge}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--pg-ink-muted)]">
                    {demo.description}
                  </p>
                </div>

                <span
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-[var(--pg-line)] text-[var(--pg-ink)] transition-all duration-200 group-hover:border-[var(--pg-ink)] group-hover:bg-[var(--pg-ink)] group-hover:text-[var(--pg-paper)]"
                  aria-hidden
                >
                  <ArrowUpRight size={16} />
                </span>
              </Link>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}
