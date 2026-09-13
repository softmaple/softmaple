# Generate a CSS spring or bounce

Springs and bounces are not native CSS easings, so Motion approximates them by
sampling the curve into a `linear()` easing function. One tool covers both.

## Usage

```
generate-css-easing({ kind, duration, bounce })
```

-   **kind** — `"spring"` (default) for the usual springy settle, or `"bounce"`
    for a ball landing on a hard surface.
-   **duration** (seconds) — the **perceptual** duration: how long the motion
    appears to take. Defaults to `0.4` for a spring and `1` for a bounce.
-   **bounce** (0 to 1) — how much the spring overshoots. `0` is a firm settle
    with no overshoot, `1` is maximum wobble. Defaults to `0.2`.

### The one thing that is easy to get wrong

`bounce` means two different things in the same sentence, so read carefully:

-   As a **kind**, `"bounce"` is the gravity-like bouncing-ball easing.
-   As a **parameter**, `bounce` is the springiness of a spring.

When `kind` is `"bounce"`, the `bounce` parameter is ignored — the feel of a
bounce is controlled by duration alone.

### Reading the result

The tool returns the `<duration> <easing>` half of a CSS transition, so use it
as `transition: <property> <result>;`.

For a spring, that duration is **longer** than the one you asked for, because
it includes the settle after the motion has visually arrived. Time any sibling
animations off the duration you asked for, not the one that came back:

```css
/* generate-css-easing({ kind: "spring", duration: 0.2, bounce: 0.3 }) */
transition:
  opacity 0.2s linear,
  transform 0.35s linear(0, 0.28, 0.78, 1.04, ...);
```

### Choosing values

-   Snappy or quick: around `0.2s`
-   Normal: `0.3s` to `0.4s`
-   Slow or heavy: around `1s`
-   Bounces read better long. `1s` feels like normal gravity; shorter feels
    heavier, longer feels lighter or lower-gravity.
-   Match the product. A stock-trading interface should not overshoot. A
    wedding site can afford softer curves and longer durations.

### Examples

> "Generate a bouncy spring for a modal entrance"

→ `generate-css-easing({ kind: "spring", duration: 0.35, bounce: 0.4 })`

> "Make this drop like it hits the floor"

→ `generate-css-easing({ kind: "bounce", duration: 1 })`

## Only for CSS

This is for hand-written CSS. Inside Motion, use a spring transition directly —
`{ type: "spring", visualDuration: 0.4, bounce: 0.2 }` — rather than pasting a
sampled curve. The real spring can be interrupted mid-flight and pick up the
current velocity; a `linear()` approximation cannot.
