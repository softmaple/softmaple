# `@softmaple/ui`

Shared React component library (shadcn/ui + Tailwind CSS v4) for `apps/web`
and `apps/playground`.

Import components from subpaths, not a barrel file:

```ts
import { Button } from "@softmaple/ui/components/button";
```

To add a shadcn component, run `pnpm dlx shadcn@latest add [COMPONENT]` from
the app that owns the `components.json` you want to update.
