"use client";

import { cn } from "@softmaple/ui/lib/utils";
import { cursorClasses, iconButtonClasses, primaryClasses } from "./primitives";
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  FileText,
  UsersRound,
  Menu,
  X,
  Moon,
  Sun,
  RotateCcw,
  MessageSquare,
  MousePointer2,
  Pencil,
  Check,
  ChevronDown,
  Bold,
  Italic,
  Underline,
  List,
  Link2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { SITE_CONFIG } from "@softmaple/config";
import { LandingBrand, MapleMark } from "./Brand";
import { DecorativeMaple } from "./HeroEffects";

export function LandingHeader() {
  const [open, setOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = matchMedia("(min-width: 768px)");
    const close = () => setOpen(false);
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);
  return (
    <header
      className={cn(
        "relative z-5 w-[90%] max-w-[1320px] m-auto h-22 flex items-center justify-between gap-6",
        "max-[1200px]:gap-[18px] max-[1200px]:h-20",
        "min-[768px]:max-[1024px]:w-[93%] min-[768px]:max-[1024px]:gap-3",
        "max-[768px]:h-[78px] max-[768px]:w-[calc(100%_-_40px)] max-[768px]:gap-2",
      )}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <Link href="/" aria-label="Softmaple home">
        <LandingBrand />
      </Link>
      <nav
        id="landing-navigation"
        className={cn(
          "flex items-center gap-[38px] text-(--muted-ink) text-[16px] [&_a]:[transition:color_160ms]",
          "[&_a:hover]:text-(--ink) [&_a:hover]:underline [&_a:hover]:underline-offset-[5px]",
          "max-[1200px]:gap-[22px] max-[1200px]:text-[13px]",
          "min-[768px]:max-[1024px]:gap-[18px] min-[768px]:max-[1024px]:text-[12px]",
          "max-[768px]:hidden max-[768px]:absolute max-[768px]:top-[70px] max-[768px]:right-0 max-[768px]:left-0",
          "max-[768px]:p-4 max-[768px]:border max-[768px]:border-(--line) max-[768px]:bg-(--surface)",
          "max-[768px]:shadow-[0_8px_20px_#0000000c] max-[768px]:rounded-[6px] max-[768px]:text-[16px]",
          "max-[768px]:[&_a]:flex max-[768px]:[&_a]:items-center max-[768px]:[&_a]:min-h-12",
          open &&
            "max-[768px]:flex max-[768px]:items-stretch max-[768px]:flex-col max-[768px]:gap-0",
        )}
        aria-label="Main navigation"
      >
        <a href="#product" onClick={() => setOpen(false)}>
          Product
        </a>
        <a href="#collaboration" onClick={() => setOpen(false)}>
          Collaboration
        </a>
        <a href={SITE_CONFIG.GITHUB_REPO}>Open source</a>
        <Link className="hidden" href="/login">
          Log in
        </Link>
      </nav>
      <div className="flex items-center gap-6 max-[1200px]:gap-3.5 min-[768px]:max-[1024px]:gap-2 max-[768px]:gap-0.5">
        <button
          className={iconButtonClasses}
          type="button"
          aria-label="Toggle color theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className="dark:hidden" aria-hidden="true" />
          <Moon className="hidden dark:block" aria-hidden="true" />
        </button>
        <Link
          className={cn(
            "[transition:color_160ms] hover:text-(--ink) hover:underline hover:underline-offset-[5px] text-(--muted-ink)",
            "text-[16px]",
            "min-[768px]:max-[1024px]:text-[13px]",
            "max-[768px]:hidden",
          )}
          href="/login"
        >
          Log in
        </Link>
        <Link
          className={cn(
            primaryClasses,
            "min-h-[58px] py-0 px-7 text-[18px]",
            "max-[1200px]:min-h-[50px] max-[1200px]:text-[16px] max-[1200px]:py-0 max-[1200px]:px-[22px]",
            "min-[768px]:max-[1024px]:py-0 min-[768px]:max-[1024px]:px-4 min-[768px]:max-[1024px]:text-[14px]",
            "max-[768px]:hidden",
            "leading-[1.2]",
          )}
          href="/signup"
        >
          Start writing
        </Link>
        <button
          ref={menuButton}
          className={cn(iconButtonClasses, "hidden max-[768px]:inline-grid")}
          type="button"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="landing-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
      </div>
    </header>
  );
}

export function HeroMotion({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const media = matchMedia(
      "(min-width: 1024px) and (prefers-reduced-motion: no-preference)",
    );
    let frame = 0;
    const update = () => {
      frame = 0;
      const height = ref.current?.offsetHeight ?? 1;
      const top = ref.current?.parentElement?.getBoundingClientRect().top ?? 0;
      ref.current?.style.setProperty(
        "--unfold",
        String(
          media.matches ? Math.max(0, Math.min(1, -top / (height * 0.75))) : 0,
        ),
      );
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", scroll, { passive: true });
    media.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scroll);
      media.removeEventListener("change", update);
    };
  }, []);
  return (
    <div
      ref={ref}
      className={cn(
        "[--unfold:0] absolute [inset:0] -z-1 [container-type:inline-size]",
        "animate-[landing-art-enter_1100ms_ease-out_both]",
        "min-[1600px]:max-w-[1600px] min-[1600px]:m-auto",
        "min-[768px]:max-[1024px]:top-auto min-[768px]:max-[1024px]:bottom-0 min-[768px]:max-[1024px]:h-auto",
        "min-[768px]:max-[1024px]:aspect-[4_/_3]",
        "max-[768px]:top-auto max-[768px]:bottom-[30px] max-[768px]:left-[-33%] max-[768px]:w-[138%] max-[768px]:h-auto",
        "max-[768px]:aspect-[4_/_3]",
      )}
    >
      {children}
    </div>
  );
}

export function Narrative() {
  const section = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const finishEntrance = useRef(() => {});
  const [selected, setSelected] = useState(true);
  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    let started = false;
    let finished = false;
    const complete = () => {
      finished = true;
      element.dataset.entrance = "complete";
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
    const sync = () => {
      if (finished) return;
      if (media.matches) return complete();
      const playing = visible && !document.hidden;
      started ||= playing;
      element.style.setProperty(
        "--story-play-state",
        playing ? "running" : "paused",
      );
      element.dataset.entrance = playing
        ? "playing"
        : started
          ? "paused"
          : "waiting";
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = Boolean(entry?.isIntersecting);
        sync();
      },
      { threshold: 0.35 },
    );
    const ended = (event: AnimationEvent) => {
      if (event.animationName === "landing-adam-label") complete();
    };
    finishEntrance.current = complete;
    element.addEventListener("animationend", ended);
    document.addEventListener("visibilitychange", sync);
    media.addEventListener("change", sync);
    observer.observe(element);
    sync();
    return () => {
      observer.disconnect();
      element.removeEventListener("animationend", ended);
      document.removeEventListener("visibilitychange", sync);
      media.removeEventListener("change", sync);
      finishEntrance.current = () => {};
    };
  }, []);
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
          finishEntrance.current();
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
                  className="story-motion story-line"
                  pathLength="1"
                  d="M5 57L61 1H79"
                  stroke="#f5d747"
                  strokeWidth="2"
                />
                <circle
                  className="story-motion story-pin"
                  cx="5"
                  cy="57"
                  r="6"
                  fill="#ffdf48"
                  stroke="#fffdf4"
                  strokeWidth="2"
                />
              </svg>
              <span className="story-motion story-note block">
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
                finishEntrance.current();
                setSelected(!selected);
              }}
            >
              write together
            </button>
            <span
              className="pointer-events-none absolute left-[83%] top-[calc(100%_-_0.1em)] z-2 text-[clamp(11px,_1.35vw,_18px)] max-[768px]:text-[10px] leading-none tracking-normal"
              aria-hidden="true"
            >
              <MousePointer2 className="story-motion story-pointer absolute -left-[0.85em] -top-[0.15em] size-[2em] fill-(--ink) stroke-(--paper) stroke-[1.5]" />
              <span className="story-motion story-adam block translate-x-[0.65em] translate-y-[0.7em] rounded-[0.3em] bg-[#e5e0d4] px-[0.7em] py-[0.35em] text-[#302f29]">
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

const initialDraft =
  "Softmaple gives you a shared space to think, write, and create — together.";

export function CollaborationDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const commentInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const addCommentButton = useRef<HTMLButtonElement>(null);
  const [run, setRun] = useState(0);
  const [step, setStep] = useState(3);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialDraft);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState("");
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("");
  const [automatic, setAutomatic] = useState(true);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stop = () => {
      timers.forEach(clearTimeout);
      setStep(3);
    };
    const play = () => {
      if (media.matches || !automatic) return;
      setStep(0);
      timers.push(
        setTimeout(() => setStep(1), 350),
        setTimeout(() => setStep(2), 1700),
        setTimeout(() => setStep(3), 3000),
      );
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          play();
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    if (ref.current) observer.observe(ref.current);
    media.addEventListener("change", stop);
    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
      media.removeEventListener("change", stop);
    };
  }, [run, automatic]);
  useEffect(() => {
    if (editing) textarea.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (commenting) commentInput.current?.focus();
  }, [commenting]);

  const edit = () => {
    setAutomatic(false);
    setStep(3);
    setEditing(true);
    setStatus("Edit the demo below. Changes stay on this page.");
  };
  return (
    <div ref={ref} className="group/demo min-w-0" data-step={step}>
      <div
        className={cn(
          "relative border border-[#d9dce1] rounded-[10px] bg-(--surface) shadow-[0_8px_35px_#292a3210] py-0 px-5",
          "dark:border-(--line)",
          "max-[1200px]:py-0 max-[1200px]:px-4",
          "max-[768px]:py-0 max-[768px]:px-2.5 max-[768px]:rounded-[7px]",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-[18px] h-20 text-[16px] text-(--muted-ink)",
            "max-[1200px]:gap-3 max-[1200px]:text-[13px] max-[1200px]:h-16",
            "max-[768px]:h-[58px] max-[768px]:gap-2 max-[768px]:text-[11px]",
          )}
        >
          <span
            className={cn(
              "border-r border-r-(--line) pr-5 text-(--ink) [&_svg]:w-6 [&_svg]:h-7",
              "max-[1200px]:pr-3",
              "max-[768px]:pr-2 max-[768px]:[&_svg]:w-4 max-[768px]:[&_svg]:h-[21px]",
            )}
          >
            <MapleMark />
          </span>
          <span className="whitespace-nowrap tracking-[-0.7px] max-[768px]:tracking-[-0.3px]">
            A place for ideas
          </span>
          <div
            className={cn(
              "flex ml-auto pl-2 [&_span]:w-9 [&_span]:h-9 [&_span]:rounded-[50%] [&_span]:grid [&_span]:place-items-center",
              "[&_span]:border-[2px] [&_span]:border-(--surface) [&_span]:text-[12px] [&_span]:font-bold [&_span]:-ml-2",
              "[&_span]:text-[#2c2039] [&_span]:bg-[#d8a2f0] [&_span:nth-child(2)]:bg-[#8fd1fa]",
              "[&_span:nth-child(2)]:text-[#143e5b] [&_span:nth-child(3)]:bg-[#a1dbbc] [&_span:nth-child(3)]:text-[#234d35]",
              "max-[1200px]:[&_span]:w-[30px] max-[1200px]:[&_span]:h-[30px]",
              "max-[768px]:pl-1 max-[768px]:[&_span]:w-[25px] max-[768px]:[&_span]:h-[25px] max-[768px]:[&_span]:text-[9px]",
              "max-[768px]:[&_span]:ml-[-7px]",
              "max-[361px]:hidden",
            )}
            aria-label="Fictional demo collaborators: Mia, Adam, and Leo"
          >
            <span>M</span>
            <span>A</span>
            <span>L</span>
          </div>
          <button
            ref={editButton}
            className={cn(
              "border border-(--line) min-h-11 py-0 px-3.5 rounded-[5px] text-[14px] flex items-center gap-[7px]",
              "whitespace-nowrap [&_svg]:w-3.5 [&_svg]:h-3.5 hover:bg-(--yellow) hover:text-[#111]",
              "max-[1200px]:py-0 max-[1200px]:px-[9px] max-[1200px]:text-[12px] max-[1200px]:[&_svg]:hidden",
              "max-[768px]:py-0 max-[768px]:px-2 max-[768px]:text-[10px]",
              "max-[361px]:ml-auto",
            )}
            type="button"
            onClick={edit}
          >
            <Pencil aria-hidden="true" />
            <span>Try writing</span>
          </button>
        </div>
        <div
          className={cn(
            "border border-(--line) rounded-[6px_6px_0_0] border-b-0 min-h-[370px]",
            "max-[1200px]:min-h-[325px]",
            "min-[768px]:max-[1024px]:min-h-[380px]",
            "max-[768px]:min-h-[280px]",
          )}
        >
          <div
            className={cn(
              "h-[54px] border-b border-b-(--line) flex items-center gap-[18px] py-0 px-[22px] text-[13px] text-(--muted-ink)",
              "[&>span]:flex [&>span]:items-center [&>span]:gap-[18px] [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:shrink-0",
              "[&_i]:h-[18px] [&_i]:w-[1px] [&_i]:bg-(--line)",
              "max-[1200px]:gap-[13px] max-[1200px]:py-0 max-[1200px]:px-4 max-[1200px]:text-[11px] max-[1200px]:h-[46px]",
              "max-[1200px]:[&>span]:gap-2.5",
              "max-[768px]:h-[42px] max-[768px]:gap-[15px] max-[768px]:py-0 max-[768px]:px-3 max-[768px]:text-[10px]",
              "max-[768px]:[&>span:last-child]:hidden max-[768px]:[&>i:last-of-type]:hidden max-[768px]:[&_svg]:w-3",
              "max-[768px]:[&_svg]:h-3 max-[768px]:[&_i]:h-[15px]",
              "max-[361px]:gap-2.5",
            )}
            aria-hidden="true"
          >
            <span>
              Paragraph <ChevronDown />
            </span>
            <i />
            <Bold />
            <Italic />
            <Underline />
            <i />
            <List />
            <Link2 />
            <i />
            <span>Rich text</span>
          </div>
          <div
            className={cn(
              "pt-9 px-10 pb-14 [font-family:Georgia,_'Times_New_Roman',_serif] text-[20px] [&_h3]:text-(--ink)",
              "[&_h3]:text-[50px] [&_h3]:tracking-[-2.5px] [&_h3]:font-semibold [&_h3]:mt-0 [&_h3]:mx-0 [&_h3]:mb-[30px]",
              "[&_p]:text-(--muted-ink) [&_p]:mt-0 [&_p]:mx-0 [&_p]:mb-6",
              "max-[1200px]:pt-8 max-[1200px]:px-7 max-[1200px]:pb-[38px] max-[1200px]:text-[16px]",
              "max-[1200px]:[&_h3]:text-[38px] max-[1200px]:[&_h3]:mb-7",
              "min-[768px]:max-[1024px]:text-[20px] min-[768px]:max-[1024px]:pt-9 min-[768px]:max-[1024px]:px-10",
              "min-[768px]:max-[1024px]:pb-[45px] min-[768px]:max-[1024px]:[&_h3]:text-[48px]",
              "max-[768px]:pt-7 max-[768px]:px-[18px] max-[768px]:pb-5 max-[768px]:text-[14px] max-[768px]:[&_h3]:text-[33px]",
              "max-[768px]:[&_h3]:tracking-[-1.5px] max-[768px]:[&_h3]:mb-[23px] max-[768px]:[&_p]:mb-5",
              "max-[361px]:pl-[13px] max-[361px]:pr-[13px]",
              "leading-[1.65] [&_h3]:leading-[1.1]",
              "max-[768px]:leading-[1.75]",
            )}
          >
            <h3>A place for ideas</h3>
            <p>
              We believe great ideas happen in the open.
              <br />
              <span
                className={cn(
                  "relative isolate before:content-[''] before:absolute before:-z-1 before:[inset:0] before:bg-[#f1d56c69]",
                  "before:origin-left before:[transform:scaleX(0)] before:[transition:transform_650ms_ease-out]",
                  "group-data-[step=2]/demo:before:[transform:scaleX(1)]",
                  "group-data-[step=3]/demo:before:[transform:scaleX(1)]",
                )}
              >
                Not in isolation, but in conversation.
                <span
                  className={cn(
                    cursorClasses,
                    "[--cursor-color:#087bea]",
                    "left-[calc(100%_+_12px)] top-2.5 opacity-0 [transform:translateX(-35px)]",
                    "[transition:opacity_250ms,_transform_650ms]",
                    "group-data-[step=2]/demo:opacity-100 group-data-[step=2]/demo:transform-none",
                    "group-data-[step=3]/demo:opacity-100 group-data-[step=3]/demo:transform-none",
                    "max-[1200px]:text-[10px] max-[1200px]:py-1.5 max-[1200px]:px-2",
                    "max-[768px]:top-[19px] max-[768px]:left-[70%] max-[768px]:text-[8px] max-[768px]:py-[5px] max-[768px]:px-1.5",
                  )}
                  aria-hidden="true"
                >
                  Adam
                </span>
              </span>
            </p>
            {editing ? (
              <div
                className={cn(
                  "[&_textarea]:resize-y [&_textarea]:w-full [&_textarea]:min-h-[130px] [&_textarea]:p-2.5",
                  "[&_textarea]:bg-(--paper) [&_textarea]:border [&_textarea]:border-(--line) [&_textarea]:rounded-[3px]",
                  "[&_textarea]:text-(--ink) [&_textarea]:[font:inherit]",
                )}
              >
                <label
                  className="absolute w-[1px] h-[1px] overflow-hidden [clip-path:inset(50%)] whitespace-nowrap"
                  htmlFor="demo-draft"
                >
                  Your demo paragraph
                </label>
                <textarea
                  id="demo-draft"
                  ref={textarea}
                  value={draft}
                  maxLength={600}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="button"
                  className="inline-flex items-center gap-2 min-h-11 [font:14px_var(--font-body),_sans-serif] [&_svg]:w-4"
                  onClick={() => {
                    setEditing(false);
                    editButton.current?.focus();
                    setStatus(
                      "Your paragraph is saved in this demo for this visit.",
                    );
                  }}
                >
                  <Check aria-hidden="true" />
                  Done
                </button>
              </div>
            ) : (
              <p className="relative max-w-[calc(100%_-_165px)] wrap-anywhere max-[768px]:max-w-[none]">
                {draft === initialDraft ? (
                  <>
                    Softmaple gives you a shared space to think, write, and{" "}
                    <span
                      className={cn(
                        "inline-block align-bottom [clip-path:inset(0)]",
                        "group-data-[step=0]/demo:[clip-path:inset(0_100%_0_0)]",
                        "group-data-[step=1]/demo:animate-[landing-type-phrase_1100ms_steps(18,_end)_both]",
                        "motion-reduce:[clip-path:none]!",
                      )}
                    >
                      create — together.
                    </span>
                  </>
                ) : (
                  draft || "Your next idea starts here."
                )}
                <span
                  className={cn(
                    cursorClasses,
                    "[--cursor-color:#af67d2]",
                    "relative inline-block align-[-0.8em] ml-3 [transform:translateY(0)] [transition:transform_700ms]",
                    "group-data-[step=0]/demo:[transform:translate(-45px,_-10px)]",
                    "max-[768px]:text-[9px] max-[768px]:py-1.5 max-[768px]:px-2 max-[768px]:align-[-0.65em]",
                  )}
                  aria-hidden="true"
                >
                  Mia
                </span>
              </p>
            )}
          </div>
        </div>
        <aside
          className={cn(
            "group-has-[textarea]/demo:relative group-has-[textarea]/demo:top-auto group-has-[textarea]/demo:right-auto",
            "group-has-[textarea]/demo:mt-0 group-has-[textarea]/demo:mr-0 group-has-[textarea]/demo:mb-4",
            "group-has-[textarea]/demo:ml-auto",
            "absolute w-[225px] -right-4 top-[53%] border border-(--line) bg-(--surface) rounded-[8px] py-[15px] px-[18px]",
            "shadow-[0_6px_26px_#1a202014] text-[13px] text-(--muted-ink) opacity-0 [transform:translate(12px,_10px)]",
            "invisible [transition:opacity_400ms,_transform_400ms,_visibility_400ms]",
            "group-data-[step=3]/demo:opacity-100 group-data-[step=3]/demo:transform-none group-data-[step=3]/demo:visible",
            "[&_p]:my-3 [&_p]:mx-0 [&_p]:wrap-anywhere",
            "max-[1200px]:w-[190px] max-[1200px]:py-3 max-[1200px]:px-[15px] max-[1200px]:-right-3.5",
            "max-[1200px]:text-[11px]",
            "min-[768px]:max-[1024px]:w-[205px] min-[768px]:max-[1024px]:top-[51%]",
            "max-[768px]:relative max-[768px]:top-auto max-[768px]:right-auto max-[768px]:-mt-1 max-[768px]:mr-1",
            "max-[768px]:mb-4 max-[768px]:ml-auto max-[768px]:w-[205px] max-[768px]:py-3 max-[768px]:px-3.5",
            "max-[768px]:text-[11px] max-[768px]:[&_p]:my-[9px] max-[768px]:[&_p]:mx-0",
            "[&_p]:leading-[1.4]",
          )}
          aria-label="Demo comment"
        >
          <div className="flex items-center gap-[7px] text-[11px] [&_strong]:text-(--ink) [&_strong]:font-medium">
            <span
              className="inline-grid place-items-center w-[23px] h-[23px] bg-[#c1e5d2] text-[#185b45] rounded-[50%] [font:600_11px_var(--font-body),_sans-serif] shrink-0"
              aria-hidden="true"
            >
              L
            </span>
            <strong>Leo</strong>
            <span>Demo</span>
          </div>
          <p>What if we tried this together?</p>
          {reply ? (
            <p className="pt-2.5 border-t border-t-(--line)">
              <strong>You</strong>
              <br />
              {reply}
            </p>
          ) : null}
          <button
            className="flex w-full justify-between items-center min-h-[30px] text-left hover:text-(--ink) [&_svg]:w-4 [&_svg]:h-4"
            type="button"
            onClick={() => {
              setAutomatic(false);
              setStep(3);
              setCommenting(!commenting);
            }}
          >
            Reply <MessageSquare aria-hidden="true" />
          </button>
        </aside>
      </div>
      <div
        className={cn(
          "flex items-center justify-between gap-3 text-(--muted-ink) text-[11px] pt-2 [&_button]:inline-flex",
          "[&_button]:items-center [&_button]:gap-1.5 [&_button]:min-h-11 [&_button]:whitespace-nowrap",
          "[&_button:hover]:underline [&_button:hover]:underline-offset-[4px] [&_button:hover]:text-(--ink)",
          "[&_svg]:w-[13px] [&_svg]:h-[13px]",
          "max-[1200px]:gap-[9px] max-[1200px]:text-[10px] max-[1200px]:flex-wrap",
          "max-[768px]:grid max-[768px]:grid-cols-[1fr_auto] max-[768px]:gap-x-[15px] max-[768px]:gap-y-0",
          "max-[768px]:text-[10px] max-[768px]:pt-3 max-[768px]:[&>span]:col-span-full max-[768px]:[&_button]:min-h-11",
          "max-[768px]:[&_button]:text-[11px] max-[768px]:[&_button:first-of-type]:justify-self-start",
        )}
      >
        <span>Interactive demo · fictional collaborators</span>
        <button
          type="button"
          onClick={() => {
            setAutomatic(true);
            setRun(run + 1);
            setStatus("Replaying the collaboration demo. Your edits are kept.");
          }}
          aria-label="Replay collaboration demo"
        >
          <RotateCcw aria-hidden="true" />
          Replay
        </button>
        <button
          type="button"
          onClick={() => {
            setAutomatic(false);
            setStep(3);
            setCommenting(!commenting);
          }}
          ref={addCommentButton}
          aria-expanded={commenting}
          aria-controls="demo-comment-form"
        >
          <MessageSquare aria-hidden="true" />
          Add comment
        </button>
      </div>
      {commenting ? (
        <form
          id="demo-comment-form"
          className={cn(
            "py-[15px] px-0 text-(--muted-ink) text-[14px] [&_label]:block [&_label]:mb-2 [&>div]:flex [&>div]:gap-2.5",
            "[&_input]:w-full [&_input]:min-w-0 [&_input]:border [&_input]:border-(--line) [&_input]:bg-(--surface)",
            "[&_input]:text-(--ink) [&_input]:rounded-[5px] [&_input]:p-2.5",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            if (comment.trim()) {
              setReply(comment.trim());
              setComment("");
              setCommenting(false);
              addCommentButton.current?.focus();
              setStatus("Your comment was added to the demo.");
            }
          }}
        >
          <label htmlFor="demo-comment">Your reply to Leo</label>
          <div>
            <input
              ref={commentInput}
              id="demo-comment"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Add your thought…"
              maxLength={200}
              required
            />
            <button
              className={cn(
                primaryClasses,
                "min-h-11 text-[14px] py-0 px-3.5 whitespace-nowrap gap-2 [&_svg]:w-4 [&_svg]:h-4",
                "max-[1200px]:min-h-11 max-[1200px]:text-[14px] max-[1200px]:px-3.5 max-[1200px]:gap-2",
                "max-[768px]:min-h-11 max-[768px]:text-[14px] max-[768px]:px-3.5",
                "leading-[1.2]",
              )}
              type="submit"
            >
              Add reply <ArrowUpRight aria-hidden="true" />
            </button>
          </div>
        </form>
      ) : null}
      <p
        className="absolute w-[1px] h-[1px] overflow-hidden [clip-path:inset(50%)] whitespace-nowrap"
        role="status"
      >
        {status}
      </p>
    </div>
  );
}
