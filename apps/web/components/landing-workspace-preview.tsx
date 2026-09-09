"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import {
  Bold,
  ChevronLeft,
  EllipsisVertical,
  FileText,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Search,
  Share,
  Sparkles,
  Type,
  Underline,
} from "lucide-react";

/**
 * A still of the workspace, held at a couple of degrees off the page.
 *
 * The tilt and the parallax on the floating chips come from one pair of CSS
 * variables written at most once per frame; every transform is expressed in
 * `design.css`, so a reduced-motion reader gets the same flat composition
 * without any of the listeners.
 */

const notes = [
  { title: "A small idea for Saturday", when: "Just now", active: true },
  { title: "Book ideas", when: "2d ago", active: false },
  { title: "Team brainstorm", when: "1w ago", active: false },
];

const checklist = [
  { label: "Find a trail near the water", done: true },
  { label: "Bring coffee and a notebook", done: false },
  { label: "Leave the afternoon open", done: false },
];

const people = [
  { initial: "L", name: "Lina", colour: "var(--person-violet)" },
  { initial: "K", name: "Kai", colour: "var(--person-plum)" },
  { initial: "M", name: "Mara", colour: "var(--person-teal)" },
];

const toolbar = [
  [Type, Bold, Italic, Underline],
  [List, ListOrdered],
  [Link2, ImageIcon],
];

function Avatar({
  initial,
  colour,
  className = "",
}: {
  readonly initial: string;
  readonly colour: string;
  readonly className?: string;
}) {
  return (
    <span
      className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-medium text-surface ${className}`}
      style={{ background: colour }}
    >
      {initial}
    </span>
  );
}

export function LandingWorkspacePreview() {
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");

    let frame = 0;
    let x = 0;
    let y = 0;

    const write = () => {
      frame = 0;
      stage.style.setProperty("--px", x.toFixed(3));
      stage.style.setProperty("--py", y.toFixed(3));
    };

    const track = (event: PointerEvent) => {
      const box = stage.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      x =
        Math.max(
          -1,
          Math.min(1, (event.clientX - box.left) / box.width - 0.5),
        ) * 2;
      y =
        Math.max(
          -1,
          Math.min(1, (event.clientY - box.top) / box.height - 0.5),
        ) * 2;
      if (frame === 0) frame = requestAnimationFrame(write);
    };

    const settle = () => {
      x = 0;
      y = 0;
      if (frame === 0) frame = requestAnimationFrame(write);
    };

    const sync = () => {
      stage.removeEventListener("pointermove", track);
      stage.removeEventListener("pointerleave", settle);
      settle();
      if (!fine.matches || still.matches) return;
      stage.addEventListener("pointermove", track);
      stage.addEventListener("pointerleave", settle);
    };

    sync();
    fine.addEventListener("change", sync);
    still.addEventListener("change", sync);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      fine.removeEventListener("change", sync);
      still.removeEventListener("change", sync);
      stage.removeEventListener("pointermove", track);
      stage.removeEventListener("pointerleave", settle);
    };
  }, []);

  return (
    <div ref={stageRef} className="landing-stage relative">
      <div className="landing-window" aria-hidden="true">
        <div className="flex items-center gap-1.5 border-b px-4 py-3">
          <span className="size-2.5 rounded-full bg-[#f0655a]" />
          <span className="size-2.5 rounded-full bg-[#f2bf4d]" />
          <span className="size-2.5 rounded-full bg-[#61c554]" />
        </div>

        <div className="grid sm:grid-cols-[minmax(0,0.46fr)_minmax(0,1fr)]">
          <div className="hidden flex-col gap-3 border-r bg-workspace p-4 sm:flex">
            <div className="flex items-center gap-2">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 whitespace-nowrap rounded-md border bg-surface px-2 py-1.5 text-[10px] text-muted-foreground">
                <Search size={11} className="shrink-0" />
                <span className="truncate">Search notes…</span>
              </span>
              <span className="grid size-6 shrink-0 place-items-center rounded-md border bg-surface text-xs">
                +
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {notes.map((note) => (
                <li
                  key={note.title}
                  className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${note.active ? "bg-accent" : ""}`}
                >
                  <FileText
                    size={11}
                    className="mt-0.5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 leading-tight">
                    <span className="block truncate text-[11px] font-medium">
                      {note.title}
                    </span>
                    <span className="mt-0.5 block text-[9px] text-muted-foreground">
                      {note.when}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="landing-paper min-w-0 bg-surface">
            <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-muted-foreground">
              <ChevronLeft size={13} />
              <span className="truncate">Personal / Weekend notes</span>
              <span
                className="landing-float ml-auto flex items-center gap-2"
                style={{ "--lift": 10 } as CSSProperties}
              >
                <span className="flex -space-x-1.5">
                  {people.map((person) => (
                    <Avatar
                      key={person.name}
                      initial={person.initial}
                      colour={person.colour}
                      className="ring-2 ring-[var(--surface)]"
                    />
                  ))}
                </span>
                <span className="hidden whitespace-nowrap md:inline">
                  3 here
                </span>
                <span className="hidden items-center gap-1 rounded-md border bg-raised px-2 py-1 md:flex">
                  <Share size={11} />
                  Share
                </span>
                <EllipsisVertical size={13} />
              </span>
            </div>

            <div className="px-5 pb-6">
              <p className="type-editorial text-xl leading-tight text-foreground sm:text-2xl">
                A small idea for Saturday
              </p>

              <div className="mt-3 flex items-center gap-4 rounded-md border bg-workspace px-3 py-2 text-muted-foreground">
                {toolbar.map((group, groupIndex) => (
                  <span key={groupIndex} className="flex items-center gap-2">
                    {group.map((Icon, index) => (
                      <Icon key={index} size={12} />
                    ))}
                  </span>
                ))}
                <span className="ml-auto flex items-center gap-1 whitespace-nowrap text-[10px] text-emphasis">
                  <Sparkles size={11} />
                  Ask AI
                </span>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)]">
                <div
                  className="hidden rounded-md border lg:block"
                  style={{
                    background:
                      "linear-gradient(160deg, #2f4a35 0%, #6f8f52 42%, #cfd9a8 72%, #7e9ec0 100%)",
                  }}
                />
                <div className="min-w-0 text-[11px] leading-5">
                  <p className="font-medium">A slower kind of weekend</p>
                  <p className="mt-1.5 text-muted-foreground">
                    Somewhere close. No packed schedule. Just a little room to
                    wander.
                  </p>
                  <p className="mt-2 mb-3.5">
                    <span className="relative inline-block rounded-[2px] bg-[color-mix(in_srgb,var(--person-violet)_22%,transparent)] px-0.5 outline outline-1 outline-[var(--person-violet)]">
                      Take the scenic route
                      <span
                        className="landing-float landing-chip absolute right-0 top-full z-10 rounded-b-[3px] rounded-tl-[3px] px-1.5 py-px text-[9px] leading-tight text-surface"
                        style={
                          {
                            background: "var(--person-violet)",
                            "--lift": 14,
                          } as CSSProperties
                        }
                      >
                        Lina
                      </span>
                    </span>
                  </p>

                  <div
                    className="landing-float landing-chip relative z-10 ml-6 -mr-2 flex items-start gap-2 rounded-lg border bg-raised px-2.5 py-2"
                    style={{ "--lift": 18 } as CSSProperties}
                  >
                    <Avatar initial="K" colour="var(--person-plum)" />
                    <span className="min-w-0">
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-[10px] font-medium">Kai</span>
                        <span className="text-[9px] text-muted-foreground">
                          2m ago
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">
                        I know the perfect spot.
                      </span>
                    </span>
                  </div>

                  <p className="mt-3 mb-3.5 text-muted-foreground">
                    Maybe we can stop at that little lake on the way and see
                    where the day takes us.
                    <span className="relative ml-px inline-block h-3 w-px translate-y-0.5 bg-primary align-middle">
                      <span
                        className="landing-float landing-chip absolute left-0 top-full z-10 rounded-b-[3px] rounded-tr-[3px] bg-primary px-1.5 py-px text-[9px] leading-tight text-primary-foreground"
                        style={{ "--lift": 14 } as CSSProperties}
                      >
                        You
                      </span>
                    </span>
                  </p>

                  <ul className="mt-3 flex flex-col gap-1.5">
                    {checklist.map((item) => (
                      <li key={item.label} className="flex items-center gap-2">
                        <span
                          className={`grid size-3.5 shrink-0 place-items-center rounded-[3px] border text-[8px] ${
                            item.done
                              ? "border-transparent bg-link text-surface"
                              : ""
                          }`}
                        >
                          {item.done ? "✓" : ""}
                        </span>
                        <span
                          className={
                            item.done ? "text-muted-foreground" : undefined
                          }
                        >
                          {item.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="landing-rule mt-5" />
              <p className="type-hand mt-3 text-sm">
                Good company turns simple plans into great days.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
