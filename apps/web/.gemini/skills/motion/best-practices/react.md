# Motion for React

Rules for using Motion in React and TypeScript projects. Framer Motion is now called Motion for React — all Framer Motion knowledge applies.

## Importing

-   **Never** import from `framer-motion`.
-   Import from `motion/react` in client components.
-   In server components, import `motion` like: `import * as motion from "motion/react-client"`
-   Files marked `"use client"` must import from `"motion/react"`.
-   The `animate` function: import from `"motion/react"` in React files, from `"motion"` elsewhere.

## MotionValues

-   **Never** read from a `MotionValue` in a render. Only read in effects/callbacks.
    -   OK: `useTransform(() => value.get())`
    -   Bad: `propName={value.get()}`

## React Patterns

-   Compose chains of `useTransform`, `useSpring`, `useMotionValue`, and `useVelocity` rather than complex imperative logic
-   Prefer `willChange` over `transform: translateZ(0)`
-   When animating MotionValues:
    -   Use `animate()` to animate the source MotionValue directly
    -   Don't use the `transition` prop when values are driven by MotionValues via `style`
    -   Derived values (via `useTransform`, `useSpring`) automatically follow the source animation

## `useTransform`

Two current syntaxes:

1. `useTransform(value, inputRange, outputRange, options)` — prefer this
2. `useTransform(() => otherMotionValue.get() * 2)` — function syntax

**Deprecated** (never use): `useTransform(value, (latestValue) => newValue)`

## Radix Integration

When integrating with Radix:

-   Add animations via `asChild` + a `motion` component child (`motion.div`, `motion.li`)
-   For exit/layout animations, hoist Radix state into `useState` (`open`/`onOpenChange`, `value`/`onValueChange`)
-   Conditionally render the Radix component as child of `AnimatePresence`
-   The component accepting `forceMount` is what goes inside `AnimatePresence`, and `forceMount` must be set
-   Only apply `forceMount` on Radix components, never on DOM elements

## API guidance

The latest docs are available via the Motion MCP. Check the [Codex](../codex/index.md) documentation.
