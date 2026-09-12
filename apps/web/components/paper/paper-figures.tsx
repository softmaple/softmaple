import type { CSSProperties } from "react";

/**
 * The paper's two figures.
 *
 * Both are scroll-scrubbed CSS (see `app/design.css`): they play forward as
 * the reader arrives and rewind if they scroll back, which is the only kind of
 * figure animation that stays honest under a flick. Without scroll timelines,
 * or under reduced motion, each figure renders in its finished state.
 */

const ch = (characters: number): CSSProperties =>
  ({ "--line-length": `${characters}ch` }) as CSSProperties;

const tint = (color: string): CSSProperties =>
  ({ "--writer": color }) as CSSProperties;

const LINA = "var(--success)";
const YOU = "var(--primary)";

/**
 * Figure 1 — no turns.
 *
 * One sentence, two people inside it at the same moment. Both contributions
 * type themselves on overlapping scroll ranges, so neither one is waiting for
 * the other to finish: that is the whole claim, shown rather than asserted.
 */
export const PresenceFigure = () => (
  <div className="fig-frame">
    <div className="fig-chrome">
      <span className="fig-dot" />
      <span className="truncate">carbon-cycle.md</span>
      <span className="ml-auto shrink-0">2 writing</span>
    </div>
    <p className="fig-line">
      <span>A mature maple </span>
      <span className="writer-group" style={tint(LINA)}>
        <span className="writer" data-writer="1" style={ch(11)}>
          fixes 22 kg
        </span>
        <span className="writer-flag">Lina</span>
      </span>
      <span className="writer-group" style={tint(YOU)}>
        <span className="writer" data-writer="2" style={ch(18)}>
          {" of carbon a year."}
        </span>
        <span className="writer-flag">You</span>
      </span>
    </p>
  </div>
);

/**
 * Figure 2 — convergence.
 *
 * Three strands of one history: two people writing at once and one of them
 * offline for part of it. The strands draw themselves as the reader scrolls
 * and meet at a single text, which is what replaying the history produces
 * regardless of the order the edits arrived in.
 */
export const ConvergenceFigure = () => (
  <div className="fig-frame">
    <div className="fig-chrome">
      <span className="fig-dot" />
      <span>history</span>
      <span className="ml-auto shrink-0">replayed</span>
    </div>
    <div className="fig-graph">
      <svg aria-hidden="true" className="fig-svg" viewBox="0 0 320 120">
        <g
          className="fig-strands"
          fill="none"
          strokeLinecap="round"
          strokeWidth="1.5"
        >
          <path
            d="M8 22 H150 C210 22 210 60 250 60"
            data-strand="1"
            pathLength={1}
          />
          <path d="M8 60 H250" data-strand="2" pathLength={1} />
          <path d="M8 98 H120" data-strand="3" pathLength={1} />
          <path
            d="M120 98 C200 98 210 60 250 60"
            data-strand="4"
            pathLength={1}
          />
          {/* The merged history, and the single text it replays to. */}
          <path d="M250 60 H292" data-strand="5" pathLength={1} />
        </g>
        <g className="fig-events">
          {[
            [42, 22, 1],
            [86, 22, 1],
            [130, 22, 1],
            [56, 60, 2],
            [104, 60, 2],
            [168, 60, 2],
            [64, 98, 3],
            [100, 98, 3],
            [298, 60, 5],
          ].map(([x, y, strand]) => (
            <circle
              cx={x}
              cy={y}
              data-strand={strand}
              key={`${x}-${y}`}
              r={strand === 5 ? 5 : 3.5}
            />
          ))}
        </g>
      </svg>
      <ul className="fig-legend">
        <li style={tint(YOU)}>You</li>
        <li style={tint(LINA)}>Lina</li>
        <li style={tint("var(--muted-foreground)")}>Lina, offline</li>
      </ul>
      <p className="fig-result">One text, in any order</p>
    </div>
  </div>
);

export const FIGURES: Readonly<Record<string, () => React.JSX.Element>> = {
  convergence: ConvergenceFigure,
  presence: PresenceFigure,
};
