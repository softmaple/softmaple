import { motion, useReducedMotion } from "motion/react";

const cursors = [
  {
    id: "a",
    color: "#2DD4BF",
    label: "You",
    path: { x: [58, 72, 80, 64, 58], y: [18, 28, 22, 34, 18] },
    duration: 14,
    mobileHide: false,
  },
  {
    id: "b",
    color: "#FB923C",
    label: "Alex",
    path: { x: [78, 86, 74, 82, 78], y: [42, 52, 60, 48, 42] },
    duration: 16,
    mobileHide: false,
  },
  {
    id: "c",
    color: "#818CF8",
    label: "Sam",
    path: { x: [66, 74, 88, 70, 66], y: [68, 58, 72, 80, 68] },
    duration: 18,
    mobileHide: true,
  },
] as const;

const lines = [
  { x1: 55, y1: 20, x2: 88, y2: 35 },
  { x1: 62, y1: 48, x2: 90, y2: 58 },
  { x1: 58, y1: 72, x2: 85, y2: 78 },
] as const;

/**
 * Full-bleed collaboration field: drifting cursors and soft sync arcs.
 * Kept to the right half so hero copy stays readable on all viewports.
 */
export function SyncField() {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_78%_32%,var(--pg-glow-teal),transparent_52%),radial-gradient(ellipse_at_88%_68%,var(--pg-glow-orange),transparent_48%),radial-gradient(ellipse_at_70%_85%,var(--pg-glow-accent),transparent_42%)]" />

      {/* Soft grid — Motion/Linear product-canvas cue */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in srgb, var(--pg-line) 80%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--pg-line) 80%, transparent) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage:
            "radial-gradient(ellipse 70% 80% at 78% 45%, black 20%, transparent 75%)",
        }}
      />

      <div className="absolute inset-y-0 right-0 w-[58%] max-md:opacity-70">
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
          focusable="false"
        >
          {lines.map((line) => (
            <motion.line
              key={`${line.x1}-${line.y1}-${line.x2}-${line.y2}`}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="currentColor"
              strokeWidth="0.2"
              className="text-[var(--pg-ink)]/25"
              strokeDasharray="1.4 1.1"
              initial={false}
              animate={
                reduceMotion
                  ? undefined
                  : { strokeDashoffset: [0, -4], opacity: [0.25, 0.7, 0.25] }
              }
              transition={{
                duration: 6,
                repeat: Number.POSITIVE_INFINITY,
                ease: "linear",
              }}
            />
          ))}
        </svg>

        {cursors.map((cursor) => {
          const x0 = cursor.path.x[0];
          const y0 = cursor.path.y[0];
          // Size to the parent so % x/y transforms stay parent-relative
          // (matching the previous left/top % keyframes).
          return (
            <motion.div
              key={cursor.id}
              className={`absolute h-full w-full ${cursor.mobileHide ? "max-md:hidden" : ""}`}
              style={{ left: `${x0}%`, top: `${y0}%` }}
              initial={false}
              animate={
                reduceMotion
                  ? undefined
                  : {
                      x: cursor.path.x.map((v) => `${v - x0}%`),
                      y: cursor.path.y.map((v) => `${v - y0}%`),
                    }
              }
              transition={
                reduceMotion
                  ? undefined
                  : {
                      duration: cursor.duration,
                      repeat: Number.POSITIVE_INFINITY,
                      ease: "easeInOut",
                    }
              }
            >
              <div className="relative -translate-x-1 -translate-y-1">
                <svg
                  width="18"
                  height="22"
                  viewBox="0 0 18 22"
                  fill="none"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M1 1L16.5 10.2L9.2 12.1L6.8 20.5L1 1Z"
                    fill={cursor.color}
                    stroke="#050505"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
                <span
                  className="absolute left-4 top-4 whitespace-nowrap rounded-sm px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-medium text-[#050505]"
                  style={{ backgroundColor: cursor.color }}
                >
                  {cursor.label}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--pg-paper)] to-transparent" />
      <div className="absolute inset-y-0 left-0 w-[42%] bg-gradient-to-r from-[var(--pg-paper)] via-[var(--pg-paper)]/85 to-transparent max-md:w-[55%]" />
    </div>
  );
}
