# Landing effects

The `/` route retains the original HTML, layout, responsive styles, paper ribbon,
brush and maple artwork. Animation orchestration uses Motion for React (`motion/react`).
The hero copy remains server rendered; client wrappers accept server-rendered children.

```text
Motion
├── scroll-linked animation
├── hero entrance and brush timeline
├── narrative choreography and SVG drawing
├── collaboration demo sequencing
└── shader strength timing

WebGL
├── shader
├── masks
├── textures
└── rendering

CSS
├── styling, layout and themes
├── hover/focus and small active-state movement
├── static artwork and pre-hydration fallback
└── reduced/no-JS behavior

React
└── UI state: annotation, editing, replies, replay and brush completion
```

## Components and timelines

- `motion/HeroMotion.tsx` owns `useScroll` / `useTransform` values. On desktop
  (at least 1024 px), scrolling through 75% of the artwork height moves the image
  and its canvas up 32 px and fades them to 0.75. The note moves up 24 px, rotates
  from 12° to 2°, and reveals its background to 0.9 opacity. Motion values reach
  the elements directly; scrolling does not update React state or read layout in
  a custom scroll handler. Tablet/mobile and reduced motion retain the original
  zero-unfold appearance. Independent first-screen entrances retain the copy's
  12 px rise / 850 ms fade and the artwork's 1100 ms fade. As before, these short
  entrances complete independently of the foreground brush sequence.
- `motion/TogetherBrush.tsx` waits 450 ms, then reveals `together-brush.svg` over
  800 ms. `animate` drives a source MotionValue with the original smoothstep
  easing; range-based `useTransform` supplies the clip polygon directly to
  `motion.span`, with no per-frame DOM style writes. The reveal front stays diagonal. The SVG never scales and
  retains its irregular dry-brush texture. `together.` remains readable HTML.
- `HeroEffects.tsx` shares only the brush-completion event and landing preferences;
  it also renders the unchanged decorative maple images.
- `effects/PaperGlow.tsx` starts after brush completion. Motion's finite `animate`
  controls strength for two seconds with `0.28 + 0.72 * sin(π * progress)²`.
  The settled strength is 0.28, with no ongoing animation loop. Resize redraws
  remain event driven. Reduced motion draws the quiet static glow instead.
- `motion/StorySequence.ts` defines one scoped `useAnimate` sequence: pin at
  120 ms (200 ms), SVG `pathLength` at 200 ms (460 ms), Mia note at 500 ms
  (380 ms), pointer at 740 ms (560 ms), and Adam label at 1300 ms (250 ms).
  `Narrative.tsx` owns annotation state, button/keyboard interaction, Escape and
  focus restoration. Interaction completes the entrance immediately. Phone note
  positioning is unchanged. The sequence runs once and releases its animations.
- `motion/CollaborationSequence.ts` defines the demo's single timeline. Typing
  starts at 350 ms (1100 ms with 18 discrete steps), the highlight and Adam enter
  at 1700 ms (650 ms), and Leo's comment arrives at 3000 ms (400 ms). Mia moves
  into place over 700 ms. A discrete Motion value updates the demo's phase only
  at the three milestones; React never receives frame-by-frame progress.
  `CollaborationDemo.tsx` owns editing, replies and replay. Manual interaction
  completes the illustration; replay preserves the visitor's draft and reply.
- `motion/LandingMotion.tsx` shares page visibility via `usePageInView`, sets
  `MotionConfig`, and subscribes to live reduced-motion changes. The explicit
  media subscription is intentional: Motion 13.2's `useReducedMotion` captures
  the initial preference without subscribing React to subsequent changes.
  `useVisiblePlayback` gates Motion controls with `useInView`; it does not keep
  elapsed time. Brush/glow, narrative and demo pause offscreen or in a hidden
  document, including their delays, and resume without restarting. Cleanup clears
  stopped controls so Strict Mode cannot revive cancelled browser animations.

## App-local Motion skill

The integration follows `apps/web/.agents/skills/motion/best-practices/`:

- Finite hero, narrative and demo movement uses complete `transform` keyframes
  so Motion can run it through the browser's Web Animations API (WAAPI).
- Scroll transforms retain individual MotionValues because they compose directly
  in `style`. Only the visible desktop artwork/note receive `will-change`; the
  hint is removed offscreen, in a hidden document, on mobile and in reduced motion.
- The brush derives its mask from one source MotionValue using the preferred
  range-based `useTransform` syntax. Completion changes React state once.
- Durations and existing easings stay explicit to preserve the choreography;
  replacing these entrances with springs would change the original timing.
- Playback controls remain necessary for visibility-driven pause/resume, including
  the shader's finite numeric animation. WebGL continues to render its pixels.

## Rendering and fallback responsibilities

`paper-glow.ts` is unchanged. It owns shader compilation, mask loading, textures,
canvas sizing, fitting and GPU resource disposal. `PaperGlow` keeps its existing
abort, context-loss and resize lifecycle around the renderer. Unavailable WebGL,
exceptions or context loss leave the source image and CTAs visible.

`paper-edge-mask.svg` and `paper-glow-mask.svg` use the original image's
**1448 × 1086** coordinate system. Edit paths there when replacing the source.
The renderer reads the sibling image's `object-fit` and `object-position`; image
and canvas share a transform. Resolution stays capped at DPR 1.5 and 1920 × 1440.

`veined-maple.webp` remains a static botanical cutout with real alpha, reused in
two positions. Its 1297 × 1213 source is WebP quality 85 with lossless alpha.
Next Image serves the existing responsive sizes. The hero loads eagerly; the
story stays lazy. It is independent of the brand SVG's landing `--brand-gold`.

`animations.css` contains no keyframes, delays or play-state orchestration. It
keeps the handwriting font, static brush texture, SVG transform origin, initial
frames before hydration, and immediate reduced-motion overrides. Simple button,
link, focus, color and active-state transitions remain in CSS/Tailwind because
these do not participate in a sequence.

Reduced motion immediately exposes the final brush, narrative and demo, disables
parallax and entrances, and settles the glow. Live preference changes cancel the
active choreography. Completed hero and narrative effects do not replay when the
preference changes back. The demo remains explicitly replayable.

Without JavaScript, ordinary styles show the final text and illustrations.
The scoped `noscript` style still reveals the landing HTML if React streams it
inside a hidden loading boundary, and removes only this route's loading placeholder.
Animation wrappers do not hide core copy before hydration, in either CSS or
server-rendered inline styles. If client scripts fail to load, core copy remains
visible; hydration progressively enhances the static hero with its entrance.

## Regression checks

```sh
pnpm --filter @softmaple/web typecheck
pnpm --filter @softmaple/web lint
pnpm --filter @softmaple/web test:e2e landing.spec.ts landing-effects.spec.ts
```

The landing suites cover brush timing and offscreen pause, finite glow and WebGL
fallback/context loss, SSR without JS, narrative background pause/completion,
keyboard interruption and focus, editing/reply/replay, reduced motion (including
live changes), scroll endpoints, dark mode and mobile navigation. Compare initial,
mid-brush, peak light and settled states at 390, 768 and 1440 px when changing
assets. The final light is deliberately quieter than its arrival peak.
