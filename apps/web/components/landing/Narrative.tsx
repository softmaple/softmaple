"use client";

import { useRef, useState } from "react";
import { FileText, UsersRound, MousePointer2 } from "lucide-react";
import { cn } from "@softmaple/ui/lib/utils";
import { DecorativeMaple } from "./HeroEffects";
import { useStorySequence } from "./motion/StorySequence";

export function Narrative() {
  const { scope: section, finish: finishEntrance } = useStorySequence();
  const trigger = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState(true);
  return (
    <section
      ref={section}
      data-entrance="waiting"
      className={cn(
        "relative w-[94%] max-w-[1380px] m-auto pt-[145px] px-0 pb-[55px] scroll-mt-[30px] [&_h2]:m-0",
        "[&_h2]:font-normal [&_h2]:text-[clamp(44px,_6.25vw,_92px)] [&_h2]:tracking-[-0.063em] [&_h2]:text-center",
        "max-[1200px]:pt-[100px] max-[1200px]:pb-[40px]",
        "max-[768px]:w-[calc(100%_-_40px)] max-[768px]:pt-[90px] max-[768px]:px-0 max-[768px]:pb-[70px]",
        "max-[768px]:[&_h2]:text-[clamp(34px,_8.8vw,_60px)] max-[768px]:[&_h2]:tracking-[-0.06em]",
        "[&_h2]:leading-[1.5]",
        "max-[768px]:[&_h2]:leading-[1.65]",
      )}
      id="collaboration"
      aria-label="A place to think out loud, write together, and turn little ideas into something shared."
      onKeyDown={(event) => {
        if (event.key === "Escape" && selected) {
          finishEntrance();
          setSelected(false);
          trigger.current?.focus();
        }
      }}
    >
      <DecorativeMaple position="story" />
      <h2 aria-label="A place to think out loud, write together, and turn little ideas into something shared.">
        <span className="block whitespace-nowrap max-[768px]:inline max-[768px]:whitespace-normal max-[768px]:after:content-['_']">
          A place to{" "}
          <a
            className="inline-flex align-[-0.06em] rounded-[4px] [&_svg]:w-[0.83em] [&_svg]:h-[0.94em] [&_svg]:stroke-[1.5] hover:text-[#9d7c00]"
            href="#experience"
            aria-label="Explore the document demo"
          >
            <FileText aria-hidden="true" />
          </a>{" "}
          <span className="relative isolate inline-block font-medium">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -z-1 inset-x-[-0.1em] top-[0.14em] bottom-[0.12em] -rotate-3 bg-[url('/landing/together-brush.svg')] bg-size-[100%_100%] bg-no-repeat opacity-55 dark:opacity-25"
            />
            think
            <span
              id="story-comment"
              role="note"
              aria-label="Illustrated comment from Mia on think"
              hidden={!selected}
              className="pointer-events-none absolute left-[calc(100%_+_1em)] bottom-[calc(100%_-_0.1em)] z-3 w-max text-left text-[clamp(12px,_1.5vw,_20px)] max-[768px]:text-[11px] leading-[1.35] tracking-[-0.02em] hidden:hidden max-[768px]:left-1/2 max-[768px]:bottom-[calc(100%_+_1.1em)] max-[768px]:-translate-x-1/2"
            >
              <svg
                viewBox="0 0 80 66"
                fill="none"
                aria-hidden="true"
                className="absolute right-[calc(100%_-_2px)] top-[0.8em] h-[3.7em] w-[4.5em] overflow-visible max-[768px]:right-auto max-[768px]:left-[16%] max-[768px]:top-[calc(100%_-_0.2em)] max-[768px]:h-[1.4em] max-[768px]:w-[1.7em]"
              >
                <path
                  className="story-line"
                  d="M5 57L61 1H79"
                  stroke="#f5d747"
                  strokeWidth="2"
                />
                <circle
                  className="story-pin"
                  cx="5"
                  cy="57"
                  r="6"
                  fill="#ffdf48"
                  stroke="#fffdf4"
                  strokeWidth="2"
                />
              </svg>
              <span className="story-note block">
                <span className="block rounded-[0.45em] bg-[#ffe991] px-[0.85em] py-[0.45em] font-medium text-[#242216]">
                  Let’s build on this.
                </span>
                <span className="mt-[0.35em] flex gap-[0.85em] px-[0.85em] text-[0.72em] font-medium text-(--ink)">
                  <span>Mia</span>
                  <span>10:24 AM</span>
                </span>
              </span>
            </span>
          </span>{" "}
          out loud,
        </span>
        <span className="block whitespace-nowrap max-[768px]:inline max-[768px]:whitespace-normal max-[768px]:after:content-['_']">
          <UsersRound
            className="inline w-[1.03em] h-[1.03em] align-[-0.13em] stroke-[1.45] mr-[0.1em] max-[768px]:w-[0.9em] max-[768px]:h-[0.9em]"
            aria-hidden="true"
          />{" "}
          <span className="relative inline-block leading-[1.05]">
            <button
              type="button"
              ref={trigger}
              className="block relative tracking-[inherit] text-inherit bg-transparent border-b-[0.045em] border-b-(--ink) p-0 leading-[1.05]"
              aria-expanded={selected}
              aria-controls="story-comment"
              onClick={() => {
                finishEntrance();
                setSelected(!selected);
              }}
            >
              write together
            </button>
            <span
              className="pointer-events-none absolute left-[83%] top-[calc(100%_-_0.1em)] z-2 text-[clamp(11px,_1.35vw,_18px)] max-[768px]:text-[10px] leading-none tracking-normal"
              aria-hidden="true"
            >
              <MousePointer2 className="story-pointer absolute -left-[0.85em] -top-[0.15em] size-[2em] fill-(--ink) stroke-(--paper) stroke-[1.5]" />
              <span className="story-adam block translate-x-[0.65em] translate-y-[0.7em] rounded-[0.3em] bg-[#e5e0d4] px-[0.7em] py-[0.35em] text-[#302f29]">
                Adam
              </span>
            </span>
          </span>
          , and turn
        </span>
        <span className="block whitespace-nowrap max-[768px]:inline max-[768px]:whitespace-normal max-[768px]:after:content-['_']">
          little ideas into something{" "}
          <em
            className={cn(
              "inline-block [font-family:'Bradley_Hand',_'Softmaple_Hand',_'Segoe_Print',_cursive] text-[1.34em] font-medium",
              "tracking-[-0.08em] [transform:rotate(-5deg)] ml-[0.06em]",
              "max-[768px]:text-[1.4em]",
              "leading-[1.1]",
            )}
          >
            shared.
          </em>
        </span>
      </h2>
    </section>
  );
}
