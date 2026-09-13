# Motion (Vanilla JS / HTML / TypeScript)

Rules for using Motion in vanilla JavaScript, TypeScript, and HTML projects.

## Importing

-   Import from `motion`, never from `framer-motion`.

## `animate`

`animate` has three valid syntaxes:

1. **MotionValue**: `animate(motionValue, targetValue, options)`
2. **Plain value**: `animate(originValue, targetValue, options)` — add `onUpdate` to `options`
3. **Element/object**: `animate(objectOrElement, values, options)`

When animating motion values, don't track the current animation in a variable — use `value.stop()` to end the current animation. Starting a new animation on the same value automatically cancels the previous one.

## Easing

Easing is defined via the `ease` option using camelCase: `easeOut`, `easeInOut`, `circOut`, etc. Not `ease-out` or `ease-in-out`.

## API guidance

The latest docs are available via the Motion MCP. Check the [Codex](../codex/index.md) documentation.
