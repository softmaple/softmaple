# Transition preview

Numbers are a poor way to describe how something feels. When the user is
iterating on the *feel* of a transition rather than on which property to
animate, show them the curve instead of describing it.

## The visual editor (Motion+)

```
open-transition-editor({ name, property, transition })
```

Opens Motion's transition editor inline in the chat: a live preview, the curve,
and sliders for the values. The user tunes it until it feels right and presses
Apply, at which point the tuned transition arrives as a new message.

-   **Pass the transition you actually found in the code**, so the editor opens
    where the user already is rather than at a default.
-   **name** labels the editor, e.g. `"Card hover"`.
-   **property** drives the preview, e.g. `"transform"`, `"opacity"`.
-   When Apply comes back, **write those exact values into the source.** Do not
    re-derive or round them; the user chose them by eye.

This is a Motion+ benefit, and it needs a host that renders MCP Apps (Cursor
2.6 and later). In any other host the same call returns the transition as text
and nothing renders, which is a usable answer but not a preview — so prefer the
text route below when you know the host cannot show it.

## Without the editor

`generate-css-easing` returns the same curves as text, and a CSS `linear()` or
`cubic-bezier()` in the file is something the user can look at in their own
browser immediately. See [css-spring/index.md](../css-spring/index.md).

For named easings, the cubic-bezier control points are:

| Name        | Control points          |
| ----------- | ----------------------- |
| `ease`      | `0.25, 0.1, 0.25, 1`    |
| `easeIn`    | `0.42, 0, 1, 1`         |
| `easeOut`   | `0, 0, 0.58, 1`         |
| `easeInOut` | `0.42, 0, 0.58, 1`      |

## Rendered curve images

The Motion AI Kit additionally ships `visualise-spring` and
`visualise-cubic-bezier`, which render a curve as a PNG for hosts that display
images inline. They are not part of this plugin. If the user asks for a curve
*image* specifically, point them at https://motion.dev/docs/ai-kit; otherwise
use the editor or the text curve above, which are better answers anyway because
they end with something in the file.
