/** Shared Tailwind recipes; all color values come from the workspace theme. */
export const homeSurface = [
  "workspace-home bg-background text-foreground [font-family:Arial,Helvetica,sans-serif]",
  "[&_:where(button,a,input):focus-visible]:outline-2 [&_:where(button,a,input):focus-visible]:outline-ring [&_:where(button,a,input):focus-visible]:outline-offset-[3px]",
  "[&_:where(button,a)]:[-webkit-tap-highlight-color:transparent] [&_button:not(:disabled)]:cursor-pointer [&_a]:cursor-pointer [&_button:disabled]:cursor-not-allowed",
  "[&_mark]:bg-secondary [&_mark]:text-foreground [&_mark]:px-[3px] [&_mark]:py-px",
  "motion-reduce:[&_*]:scroll-auto motion-reduce:[&_*]:animate-none motion-reduce:[&_*]:transition-none motion-reduce:[&_*::before]:animate-none motion-reduce:[&_*::after]:animate-none",
].join(" ");

export const homeSerif = "[font-family:'Times_New_Roman',Georgia,serif]";
export const homeHand = "[font-family:'Workspace_Hand',cursive]";
export const homeNav =
  "flex min-h-[41px] items-center gap-[17px] rounded-[6px] px-[13px] py-2 text-left text-sm leading-[21px] [&_svg]:size-[22px] [&_svg]:shrink-0 [&_svg]:stroke-[1.6] enabled:hover:bg-secondary";
export const homePrimary =
  "rounded-[6px] bg-[linear-gradient(110deg,var(--primary),var(--ws-primary-end))] text-primary-foreground hover:shadow-[var(--ws-primary-shadow)]";
export const homePaper =
  "bg-[var(--ws-paper)] bg-[url('/workspace/paper-grain.svg')]";
/** Set --fold-size on the card. Its pseudo-element never affects layout. */
export const homeFold = [
  "[clip-path:polygon(0_0,calc(100%_-_var(--fold-size))_0,100%_var(--fold-size),100%_100%,0_100%)]",
  "after:pointer-events-none after:absolute after:-right-px after:-top-px after:size-[var(--fold-size)] after:content-['']",
  "after:bg-[url('/workspace/fold-light.svg')] after:bg-center after:bg-size-[100%_100%] after:bg-no-repeat dark:after:bg-[url('/workspace/fold-dark.svg')]",
].join(" ");
export const homeMaple =
  "bg-[url('/landing/veined-maple.webp')] bg-contain bg-center bg-no-repeat opacity-[.19] dark:bg-[url('/auth/veined-maple-dark.webp')] dark:opacity-[.48]";
export const homeBrush = [
  "-ml-[.07em] tracking-[-.065em] text-[var(--ws-brush-ink)]",
  "before:absolute before:-z-1 before:top-[.07em] before:-right-[.27em] before:-bottom-[.12em] before:-left-[.1em] before:content-['']",
  "before:bg-[url('/workspace/idea-brush.svg')] before:bg-center before:bg-size-[100%_100%] before:bg-no-repeat dark:before:opacity-90",
].join(" ");
export const homeDocumentColumns =
  "grid-cols-[minmax(0,43%)_minmax(0,18%)_minmax(0,17%)_minmax(0,15%)_7%]";
