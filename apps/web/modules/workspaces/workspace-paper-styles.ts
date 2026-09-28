export const paperSurface =
  "workspace-paper bg-background text-foreground bg-[url('/workspace/paper-grain.svg')] dark:bg-none [&_:where(a,button,input,textarea):focus-visible]:outline-2 [&_:where(a,button,input,textarea):focus-visible]:outline-offset-2 [&_:where(a,button,input,textarea):focus-visible]:outline-ring";
export const paperSerif = "[font-family:Georgia,'Times_New_Roman',serif]";
/** Settings panel: bordered on desktop, edge to edge on phones. */
export const paperPanel =
  "md:rounded-md md:border md:border-border md:px-5 md:py-1";
/** A settings row: the label column sits beside its control from `md` up. */
export const paperFieldRow =
  "grid gap-2 border-border py-1.5 md:py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] md:gap-8 md:border-b md:last:border-0";
