import { useId } from "react";

/** A small folded-paper sketch, with theme-aware parchment rather than inversion. */
export function ErrorPaper() {
  const id = useId();
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 340 230"
      className="pointer-events-none h-auto w-[240px] text-[#777269] [--sheet:#fffdf7] [--fold:#dfd8c9] [--crease:#c1b7a2] dark:text-[#c5b594] dark:[--sheet:#d3c6ab] dark:[--fold:#827763] dark:[--crease:#665c48] sm:w-[300px] [@media(max-height:600px)]:w-[170px]"
    >
      <defs>
        <linearGradient id={`${id}-paper`} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="var(--sheet)" />
          <stop offset=".47" stopColor="var(--fold)" />
          <stop offset=".72" stopColor="var(--sheet)" />
          <stop offset="1" stopColor="var(--fold)" />
        </linearGradient>
        <linearGradient id={`${id}-fold`}>
          <stop stopColor="var(--crease)" stopOpacity=".65" />
          <stop offset="1" stopColor="var(--sheet)" stopOpacity=".1" />
        </linearGradient>
        <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".65"
            numOctaves="3"
            seed="8"
          />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="linear" slope=".1" />
          </feComponentTransfer>
          <feComposite in2="SourceGraphic" operator="in" />
          <feBlend in2="SourceGraphic" mode="multiply" />
        </filter>
        <radialGradient id={`${id}-shadow`}>
          <stop stopColor="#65522c" stopOpacity=".25" />
          <stop offset="1" stopColor="#65522c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="171" cy="198" rx="128" ry="19" fill={`url(#${id}-shadow)`} />
      <g filter={`url(#${id}-grain)`}>
        <path
          d="m52 177 37-21 16-63 34-51 30 18 28 24 37 17 46 1-28 37-9 45-40 18-41-6-30-15-28 3-26-7Z"
          fill={`url(#${id}-paper)`}
        />
        <path
          d="m139 42-11 73-23-22 19 53-35 10 63 17-20 8 30 15 14-48-48-33 41-55Z"
          fill={`url(#${id}-fold)`}
        />
        <path
          d="m176 148 58-47-15 58 24 25-40 18 9-33Z"
          fill={`url(#${id}-fold)`}
          opacity=".55"
        />
        <path
          d="m124 146 28 27 24-25 36 21 31 15-40 18-41-6-30-15-28 3-26-7-26 0 37-21Z"
          fill="var(--sheet)"
          opacity=".65"
        />
      </g>
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      >
        <path d="m134 46-29 47-16 63-37 21 26 0m67-132 24 15 28 24m37 17 46 1-28 37m-120 42 30 15 41 6 40-18" />
        <path
          d="m68 82-14-13m20 4-5-15m-11 28-8-3m245 74 13-7m-18 0 8-11M41 173l-12 1m18 20-10 2m237 9 9 2"
          opacity=".7"
        />
        <ellipse
          cx="225"
          cy="18"
          rx="16"
          ry="5"
          transform="rotate(-12 225 18)"
        />
        <path d="M222 32c13 8-18 4-11 13s-3 6-6 10" />
      </g>
      <g fill="#514c42">
        <ellipse
          cx="160"
          cy="124"
          rx="3.3"
          ry="4"
          transform="rotate(18 160 124)"
        />
        <ellipse
          cx="188"
          cy="132"
          rx="3.3"
          ry="4"
          transform="rotate(18 188 132)"
        />
        <path
          d="M150 149q18-14 31 8"
          fill="none"
          stroke="#514c42"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
      <g transform="translate(233 161) rotate(25)">
        <path
          d="m0-22 5 10 5-5-1 14 10-7-1 8 10-1-6 8 5 4-16 7-2 7-8-3-6 5-2-10-16-4 5-5-6-8 11 1-1-9 10 7-1-13 5 5Z"
          fill="#f3c442"
        />
        <path
          d="M0-19 0 31m0-24 15-10M0 13l-15-8"
          fill="none"
          stroke="#b78519"
          strokeWidth=".8"
          opacity=".65"
        />
      </g>
    </svg>
  );
}
