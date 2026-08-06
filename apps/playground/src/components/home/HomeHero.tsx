import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { SyncField } from "@/components/home/SyncField";

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
          initial: { opacity: 0, y: 28 },
          animate: { opacity: 1, y: 0 },
          transition: { ...spring, delay },
        };

  return (
    <section className="relative min-h-[min(92vh,920px)] overflow-hidden border-b border-[var(--pg-line)]">
      <SyncField />

      <div className="relative z-10 mx-auto flex min-h-[min(92vh,920px)] max-w-6xl flex-col justify-end px-6 pb-16 pt-16 md:pb-24 md:pt-20">
        <motion.p
          className="mb-5 font-[family-name:var(--font-mono)] text-xs tracking-[0.22em] text-[var(--pg-ink-muted)] uppercase"
          {...reveal(0)}
        >
          SoftMaple Labs
        </motion.p>

        <motion.h1
          className="max-w-4xl font-[family-name:var(--font-display)] text-[clamp(3.25rem,12vw,7.5rem)] leading-[0.92] font-bold tracking-[-0.04em] text-[var(--pg-ink)]"
          {...reveal(0.06)}
        >
          SoftMaple
          <br />
          <span className="text-[var(--pg-accent)]">Playground</span>
        </motion.h1>

        <motion.p
          className="mt-6 max-w-xl text-lg text-[var(--pg-ink-muted)] md:text-xl"
          {...reveal(0.12)}
        >
          Live CRDT demos — open a room, share the link, and watch edits sync
          across browsers.
        </motion.p>

        <motion.div
          className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center"
          {...reveal(0.18)}
        >
          <Link
            to="/demo/lexical-eg-walker"
            className="inline-flex items-center justify-center bg-[var(--pg-ink)] px-7 py-3.5 text-sm font-semibold text-[var(--pg-paper)] transition-[transform,opacity] hover:-translate-y-0.5 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pg-accent)]"
          >
            Open Lexical demo
          </Link>
          <a
            href="https://docs.softmaple.ink"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center border border-[var(--pg-line)] bg-transparent px-7 py-3.5 text-sm font-semibold text-[var(--pg-ink)] transition-colors hover:border-[var(--pg-ink-muted)] hover:bg-[var(--pg-elevated)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pg-accent)]"
          >
            Documentation
          </a>
        </motion.div>
      </div>
    </section>
  );
}
