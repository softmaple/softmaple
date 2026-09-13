---
description: Use the Motion skill for animation work, and never import from framer-motion
globs: ["**/*.{ts,tsx,js,jsx,vue,svelte,astro,css,scss,sass}"]
alwaysApply: false
---

When a change in this file animates anything — CSS `transition`/`@keyframes`,
Motion (`motion`, `motion/react`, `motion-v`), a gesture, drag, scroll effect,
reveal or page transition — use the `motion` skill first. It carries the
official patterns, the docs search and the performance tiers.

Never import from `framer-motion`. The package is `motion` (`motion/react` for
React, `motion-v` for Vue). If this file still imports `framer-motion`, say so
and offer to migrate it.
