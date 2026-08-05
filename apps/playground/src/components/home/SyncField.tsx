import { motion, useReducedMotion } from "motion/react";

const cursors = [
  {
    id: "a",
    color: "#0D9488",
    label: "You",
    path: { x: [12, 38, 52, 28, 12], y: [28, 42, 58, 70, 28] },
    duration: 14,
  },
  {
    id: "b",
    color: "#EA580C",
    label: "Alex",
    path: { x: [78, 62, 48, 70, 78], y: [22, 48, 36, 64, 22] },
    duration: 16,
  },
  {
    id: "c",
    color: "#DB2777",
    label: "Sam",
    path: { x: [55, 30, 68, 44, 55], y: [72, 55, 40, 24, 72] },
    duration: 18,
  },
] as const;

const lines = [
  { x1: 18, y1: 34, x2: 72, y2: 28 },
  { x1: 42, y1: 48, x2: 58, y2: 62 },
  { x1: 28, y1: 68, x2: 64, y2: 44 },
] as const;

/**
 * Full-bleed collaboration field: drifting cursors and soft sync arcs.
 * Signature visual for the playground hero — Motion-style ambient motion.
 */
export function SyncField() {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,rgba(13,148,136,0.12),transparent_55%),radial-gradient(ellipse_at_20%_70%,rgba(234,88,12,0.1),transparent_50%),radial-gradient(ellipse_at_80%_80%,rgba(219,39,119,0.08),transparent_45%)]" />

      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        role="presentation"
      >
        <title>Collaboration sync paths</title>
        {lines.map((line) => (
          <motion.line
            key={`${line.x1}-${line.y1}-${line.x2}-${line.y2}`}
            x1={line.x1}
            y1={line.y1}
            x2={line.x2}
            y2={line.y2}
            stroke="currentColor"
            strokeWidth="0.15"
            className="text-[var(--pg-ink)]/15"
            strokeDasharray="1.2 1.2"
            initial={false}
            animate={
              reduceMotion
                ? undefined
                : { strokeDashoffset: [0, -4], opacity: [0.25, 0.55, 0.25] }
            }
            transition={{
              duration: 6,
              repeat: Number.POSITIVE_INFINITY,
              ease: "linear",
            }}
          />
        ))}
      </svg>

      {cursors.map((cursor) => (
        <motion.div
          key={cursor.id}
          className="absolute"
          style={{ left: 0, top: 0 }}
          initial={false}
          animate={
            reduceMotion
              ? {
                  left: `${cursor.path.x[0]}%`,
                  top: `${cursor.path.y[0]}%`,
                }
              : {
                  left: cursor.path.x.map((v) => `${v}%`),
                  top: cursor.path.y.map((v) => `${v}%`),
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
              role="img"
              aria-label={`${cursor.label} cursor`}
            >
              <title>{`${cursor.label} cursor`}</title>
              <path
                d="M1 1L16.5 10.2L9.2 12.1L6.8 20.5L1 1Z"
                fill={cursor.color}
                stroke="white"
                strokeWidth="1.2"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="absolute left-4 top-4 whitespace-nowrap rounded-sm px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-medium text-white"
              style={{ backgroundColor: cursor.color }}
            >
              {cursor.label}
            </span>
          </div>
        </motion.div>
      ))}

      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[var(--pg-paper)] to-transparent" />
    </div>
  );
}
