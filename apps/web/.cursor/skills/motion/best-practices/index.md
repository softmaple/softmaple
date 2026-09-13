# Animation best practices

## Platform-specific rules

-   [React](react.md)
-   [Vue](vue.md)
-   [Vanilla JS](motion.md)
-   [Base UI](base-ui.md)

## Universal rules (all platforms)

### Performance

#### Execution speed

Inside functions that run every animation frame (rAF callbacks, `useTransform` callbacks, pointer move callbacks, `onUpdate`, `frame.render` etc):

-   Avoid object allocation. Prefer mutation where safe.
-   Prefer `for` loops over `forEach` of `map`, unless function callback can be pre-allocated.
-   Avoid `Object.entries`, `Object.values`.

#### Animating via `transform` vs independent transforms

Motion can animate transforms either via `transform` or `x`, `y`, `scale` etc.

```javascript
animate(element, { transform: "scale(2)" })
animate(element, { scale: 2 })
```

```jsx
<motion.div animate={{ transform: "scale(2)" }} />
<motion.div animate={{ scale: 2 }} />
```

Prefer `transform` as these animations will run via WAAPI. Use independent transforms when:

-   Some transforms have different transition settings
-   Some transforms need to be passed in as motion values
    Note: Passing `transform` in as a motion value will also disable WAAPI animations, so no need to prefer it if you would resort to this.
-   Defining transforms via `style` prop
-   Use independent transforms when you have competing/composable transforms:

```javascript
animate(element, { x: 100 })

hover(() => {
    animate(element, { scale: 1.2 })
    return () => animate(element, { scale: 1 })
})
```

```jsx
<motion.div animate={{ x: 100 }} whileHover={{ scale: 1.2 }} />
```

#### will-change

When animating with CSS `transition` or Motion independent transforms `x`, `y`, `scale` etc, set `will-change` on the animating properties so the browser promotes the element to its own compositor layer. Use it sparingly and remove it once the animation finishes.

When animating with CSS `animation` or Motion via `transform`, this is unnecessary — the layer is promoted automatically by the browser.

### Design

In general, prefer physics-based springs for physical motion such as `x`, `rotate` etc. Especially when it could be interrupted.

Non-numerical values won't use spring physics so you can use more predictable settings like `type: "spring", bounce: 0.2, visualDuration: 0.4`

Consider the kind of interface you are building. If a serious website like stock trading, don't use overshoot in your springs or easing curves. If it's a wedding site, you can use softer curves and slightly longer durations.

### API best practice

#### MotionValues

-   Never use `motionValue.onChange(update)` — always use `motionValue.on("change", update)`
