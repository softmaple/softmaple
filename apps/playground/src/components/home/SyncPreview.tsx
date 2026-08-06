import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const DEMO_TEXT = "Hello collab";
const STEP_MS = 90;
const HOLD_MS = 1_600;
const RESET_MS = 900;

/**
 * Lightweight dual-pane sync preview for the homepage hero.
 * Animates typing on the left and mirrored appearance on the right.
 */
export function SyncPreview() {
  const reduceMotion = useReducedMotion();
  const [chars, setChars] = useState(reduceMotion ? DEMO_TEXT.length : 0);
  const [phase, setPhase] = useState<"typing" | "hold" | "reset">(
    reduceMotion ? "hold" : "typing",
  );

  useEffect(() => {
    if (reduceMotion) {
      setChars(DEMO_TEXT.length);
      setPhase("hold");
      return;
    }

    if (phase === "typing") {
      if (chars >= DEMO_TEXT.length) {
        const timer = window.setTimeout(() => setPhase("hold"), HOLD_MS);
        return () => window.clearTimeout(timer);
      }
      const timer = window.setTimeout(() => setChars((n) => n + 1), STEP_MS);
      return () => window.clearTimeout(timer);
    }

    if (phase === "hold") {
      const timer = window.setTimeout(() => setPhase("reset"), HOLD_MS);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(() => {
      setChars(0);
      setPhase("typing");
    }, RESET_MS);
    return () => window.clearTimeout(timer);
  }, [chars, phase, reduceMotion]);

  const visible = DEMO_TEXT.slice(0, chars);
  const showCaret = phase === "typing";

  return (
    <div
      className="w-full max-w-xl"
      data-testid="home-sync-preview"
      aria-hidden
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch sm:gap-2">
        <PreviewPane
          name="Adam"
          accent="#0D9488"
          text={visible}
          caret={showCaret}
        />
        <motion.div
          className="hidden items-center justify-center px-1 font-[family-name:var(--font-mono)] text-lg text-[var(--pg-accent)] sm:flex"
          animate={
            reduceMotion
              ? undefined
              : { opacity: [0.35, 1, 0.35], x: [0, 2, 0] }
          }
          transition={{
            duration: 1.6,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        >
          →
        </motion.div>
        <PreviewPane
          name="Peer 2"
          accent="#EA580C"
          text={visible}
          caret={false}
          dimmed={chars === 0}
        />
      </div>
      <p className="mt-3 text-center font-[family-name:var(--font-mono)] text-[10px] tracking-[0.16em] text-[var(--pg-ink-muted)] uppercase">
        EG-walker · Lexical · WebSocket
      </p>
    </div>
  );
}

function PreviewPane({
  name,
  accent,
  text,
  caret,
  dimmed = false,
}: {
  name: string;
  accent: string;
  text: string;
  caret: boolean;
  dimmed?: boolean;
}) {
  return (
    <div
      className={`border border-[var(--pg-line)] bg-[var(--pg-surface)]/90 text-left shadow-sm backdrop-blur-sm transition-opacity ${
        dimmed ? "opacity-55" : "opacity-100"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-[var(--pg-line)] px-3 py-1.5">
        <span
          className="size-2 shrink-0"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
        <span className="font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-[var(--pg-ink-muted)] uppercase">
          {name}
        </span>
      </div>
      <div className="min-h-[4.5rem] px-3 py-3 font-[family-name:var(--font-mono)] text-sm text-[var(--pg-ink)]">
        {text}
        {caret ? (
          <span className="ml-px inline-block h-4 w-px translate-y-0.5 bg-[var(--pg-ink)] motion-safe:animate-pulse" />
        ) : null}
      </div>
    </div>
  );
}
