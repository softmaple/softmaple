import { Check, Circle, FileCode2, Radio, Users } from "lucide-react";

const LINE_NUMBERS = ["01", "02", "03", "04", "05", "06"] as const;

export const AuthBrandSpecimen = () => (
  <div
    aria-hidden="true"
    className="mt-10 hidden w-full max-w-2xl rounded-xl border bg-card shadow-sm lg:block"
  >
    <div className="flex items-center gap-2 border-b px-3 py-2 font-mono text-[10px] text-muted-foreground">
      <Circle className="size-2.5 fill-primary text-primary" />
      field-notes / carbon-cycle
      <span className="ml-auto flex items-center gap-1 text-success">
        <Check className="size-3" /> Saved
      </span>
    </div>

    <div className="grid grid-cols-[2.6rem_minmax(0,1fr)]">
      <div className="border-r py-5 text-center font-mono text-[9px] leading-7 text-muted-foreground">
        {LINE_NUMBERS.map((line) => (
          <span className="block" key={line}>
            {line}
          </span>
        ))}
      </div>
      <div className="relative px-5 py-5 xl:px-7">
        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-primary">
          Observation / 09:42
        </p>
        <p className="mt-4 font-display text-xl font-semibold">
          A shared record of change
        </p>
        <p className="mt-3 max-w-lg text-xs leading-6 text-muted-foreground xl:text-sm">
          A place for unfinished sentences, questions worth sitting with, and
          ideas that get better together.
        </p>
        <blockquote className="mt-4 border-l-2 border-primary pl-4 text-xs italic xl:text-sm">
          Make room for a new idea.
        </blockquote>
        <span className="absolute right-12 top-[6.8rem] h-5 border-l-2 border-success" />
        <span className="absolute right-3 top-[7rem] bg-success px-1.5 py-0.5 font-mono text-[9px] text-success-foreground">
          Lina
        </span>
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-3 border-t px-3 py-2 font-mono text-[9px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Radio className="size-3 text-primary" /> 3 active
      </span>
      <span className="flex items-center gap-1.5">
        <FileCode2 className="size-3" /> Markdown / LaTeX
      </span>
      <span className="ml-auto flex items-center gap-1.5">
        <Users className="size-3" /> Owner · 2 editors
      </span>
    </div>
  </div>
);
