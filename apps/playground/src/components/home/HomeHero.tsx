import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { SyncField } from "@/components/home/SyncField";
import { SyncPreview } from "@/components/home/SyncPreview";

const spring = { type: "spring" as const, stiffness: 280, damping: 28 };

export function HomeHero() {
  const reduceMotion = useReducedMotion();
  // Defer hidden initial state until after mount so SSR / no-JS / null
  // reduced-motion preference still shows hero content.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  const reveal = (delay: number) =>
    !ready || reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 22 },
          animate: { opacity: 1, y: 0 },
          transition: { ...spring, delay },
        };

  return (
    <section className="relative min-h-[min(68vh,720px)] overflow-hidden border-b border-[var(--pg-line)]">
      <SyncField />

      <div className="relative z-10 mx-auto flex min-h-[min(68vh,720px)] max-w-6xl flex-col justify-end gap-10 px-6 pb-12 pt-16 md:flex-row md:items-end md:justify-between md:pb-16 md:pt-20">
        <div className="max-w-xl">
          <motion.h1
            className="font-[family-name:var(--font-display)] text-[clamp(2.75rem,9vw,5.5rem)] leading-[0.94] font-bold tracking-[-0.04em] text-[var(--pg-ink)]"
            {...reveal(0)}
          >
            SoftMaple
          </motion.h1>

          <motion.p
            className="mt-4 max-w-md text-base text-[var(--pg-ink-muted)] md:text-lg"
            {...reveal(0.06)}
          >
            Local-first collaboration primitives.
          </motion.p>

          <motion.div
            className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
            {...reveal(0.12)}
          >
            <Link
              to="/demo/lexical-eg-walker"
              className="inline-flex items-center justify-center bg-[var(--pg-ink)] px-7 py-3.5 text-sm font-semibold text-[var(--pg-paper)] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pg-accent)]"
            >
              Open playground
            </Link>
            <a
              href="https://github.com/softmaple/softmaple"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center border border-[var(--pg-ink)]/20 bg-transparent px-7 py-3.5 text-sm font-semibold text-[var(--pg-ink)] transition-colors hover:border-[var(--pg-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pg-accent)]"
            >
              GitHub
            </a>
          </motion.div>
        </div>

        <motion.div className="w-full md:max-w-xl" {...reveal(0.16)}>
          <SyncPreview />
        </motion.div>
      </div>
    </section>
  );
}
