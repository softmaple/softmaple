# Authentication paper artwork

These two independent decorative assets were reconstructed from the user-supplied
login/signup reference using the built-in image generation tool. They contain no
headings, logo, form, text, cursors, comment bubbles or maple leaves. Those elements
are rendered separately by `modules/auth/auth-brand-panel.tsx` and the auth forms.
The original landing artwork is unchanged.

- `paper-login.webp`: broad S-shaped ribbon entering from the left, a low golden
  rear wave, wide blank writing surface, and a front fold exiting bottom-right.
- `paper-signup.webp`: low upper-right curl with a yellow reverse and a diagonal
  blank writing surface rolling into a front loop at lower-left.

Generation prompt specifications for both assets: reconstruct the corresponding
panel's paper geometry, fine fibrous ivory texture, golden-yellow reverse,
delicate warm edges and soft contact shadows; remove all UI, lettering and leaves;
use a square canvas with a warm-white background that blends into `#faf9f6`.
Do not generate a complete webpage or add unrelated objects.

The generated PNGs were encoded as WebP at quality 95 without resizing. Next Image
serves them without a second lossy encode to preserve their fine paper texture.

## Transparent source cutouts

`paper-login-cutout.webp` and `paper-signup-cutout.webp` are independent RGBA
cutouts edited from the corresponding originals with the built-in image tool.
They preserve the square canvas and paper placement so the HTML annotations
remain aligned. These cream cutouts are source assets for the dark variants below;
they are no longer rendered. The original artwork remains in use in light mode.

Final edit prompt (applied separately to each original):

> Use case: background-extraction. Remove only the surrounding pale studio
> background and produce a real transparent RGBA alpha background, not a
> checkerboard illustration. Preserve the exact paper silhouette, position,
> folds, scale and framing, including portions cropped at the image boundaries.
> Preserve cream-white fibrous paper texture, natural shading and honey-yellow
> reverse. Keep the paper light ivory, in the #EDE6D8 family, without inversion or
> hue shift. Keep fine soft contact shadows as transparent dark shadows, without
> a pale halo or matte, for display over warm charcoal #1C1D1A. Do not add text,
> logos, leaves, UI, cursors or other objects. Keep the blank writing face intact.

The cutouts are encoded as WebP at quality 95 with alpha quality 100 and no resize.

## Final dark-reference artwork

- `paper-login-dark.webp` and `paper-signup-dark.webp`: charcoal fibrous paper,
  ochre-gold reverse and fine golden edges, matching the user's final dark-mode
  reference supplied on September 20, 2026.
- `veined-maple-dark.webp`: dark amber maple leaf with fine golden veins, retaining
  the existing landing leaf's silhouette and orientation.

All three were edited with the built-in image tool and retain real alpha
transparency. They are served without CSS color inversion or global dimming.
The HTML headings, labels, annotations and forms remain independent of the images.

Final paper edit prompt (applied independently to login and signup):

> Use the existing paper cutout as the geometry target and the corresponding panel
> in the user's final dark UI image as the material/color reference. Preserve the
> square canvas, scale, silhouette, folds, positions and blank writing face.
> Change only the material to richly textured dark charcoal handmade paper with
> fine lighter embossed fibers, soft directional highlights, an ochre-gold reverse
> and a very thin golden edge. Use real RGBA transparency outside the ribbon.
> Avoid inverted ivory, plastic, metal, fabric, gray halos and white fringes. Add no
> text, labels, cursors, bubbles, leaves, logos or UI; never generate a full page.

Final leaf edit prompt:

> Recolor the existing maple leaf to the final reference's golden skeleton leaf:
> delicate ochre-gold primary and branching veins, a very dark translucent amber
> lamina and fine golden edges. Preserve silhouette, orientation, framing, pointed
> lobes and stem. Veins should be brighter than the nearly transparent dark body.
> Use realistic botanical texture and real alpha transparency. No backdrop,
> checkerboard, glow, text, UI or new objects.

Final assets use WebP quality 95, alpha quality 100, without resizing.
