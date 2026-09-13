# Landing effects

The `/` route retains the original `paper-ribbon.webp` and HTML content. No 3D or animation dependency is added.

The original first-screen entrance is retained: copy fades in and rises 12 px over 850 ms; the paper artwork fades in over 1100 ms. The brush runs alongside this entrance, and its completion triggers the warm light. Reduced motion disables the entrance as well as the brush/light animation.

- `TogetherBrush` renders readable server HTML. A finite foreground clock waits 450 ms, then reveals `together-brush.svg` over 800 ms with a slanted clip polygon. The SVG contains the final irregular edge and dry-brush texture; it is never scaled during the reveal.
- `HeroEffects` coordinates the brush completion with `PaperGlow`. The latter paints a transparent WebGL overlay, rises and settles over 2 seconds, then stops requesting frames. Both clocks pause outside the viewport and while the document is hidden.
- `paper-edge-mask.svg` and `paper-glow-mask.svg` use the original image's **1448 × 1086** coordinate system. Edit paths there when replacing the source. The shader reads the sibling image's `object-fit` and `object-position`; the image and canvas share their scroll transform. Resolution is capped at DPR 1.5 and 1920 × 1440.
- Section 2 emphasizes “think” with a static brush and Mia’s annotation, and pairs the underlined “write together” with a neutral Adam cursor. The annotations enter once over 1.55 seconds: pin, leader, Mia card, cursor movement, then Adam label. CSS animations pause offscreen/in the background and are removed at completion. Reduced motion and no JavaScript show the final artwork directly. The button toggles the annotation; keyboard interaction finishes the entrance immediately, and Escape dismisses the note and returns focus. On phones the note sits above the word to keep the text clear.
- `veined-maple.png` is a generated botanical cutout with real alpha, reused statically in two positions. Next Image serves appropriately sized versions. It is independent of the existing brand SVG, whose gold is scoped to the landing `--brand-gold` variable.
- Reduced motion reveals the final brush in CSS and draws a single quiet glow. WebGL failures/context loss leave the source image visible. Observers, listeners, frames, shaders, textures and buffers are cleaned up.
- The scoped `noscript` style reveals the landing HTML if React streams it inside a hidden loading boundary. It uses the landing heading to scope both the hidden-ancestor override and removal of the loading placeholder; it does not alter other routes.

Regression checks: `pnpm --filter @softmaple/web test:e2e landing.spec.ts landing-effects.spec.ts`. Check initial, mid-brush, peak light and settled states at 390, 768 and 1440 px when changing assets. The final light is deliberately quieter than its arrival peak.
