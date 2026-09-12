"use client";

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
import styles from "./landing.module.css";

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
      className={styles.header}
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
        className={`${styles.navigation} ${open ? styles.navigationOpen : ""}`}
        aria-label="Main navigation"
      >
        <a href="#product" onClick={() => setOpen(false)}>
          Product
        </a>
        <a href="#collaboration" onClick={() => setOpen(false)}>
          Collaboration
        </a>
        <a href={SITE_CONFIG.GITHUB_REPO}>Open source</a>
        <Link className={styles.mobileLogin} href="/login">
          Log in
        </Link>
      </nav>
      <div className={styles.headerActions}>
        <button
          className={styles.iconButton}
          type="button"
          aria-label="Toggle color theme"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        >
          <Sun className={styles.sun} aria-hidden="true" />
          <Moon className={styles.moon} aria-hidden="true" />
        </button>
        <Link className={styles.login} href="/login">
          Log in
        </Link>
        <Link className={styles.primary} href="/signup">
          Start writing
        </Link>
        <button
          ref={menuButton}
          className={`${styles.iconButton} ${styles.menuButton}`}
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
    <div ref={ref} className={styles.heroArt}>
      {children}
    </div>
  );
}

export function Narrative() {
  const ref = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          ref.current?.setAttribute("data-revealed", "true");
          if (!media.matches) setSelected(true);
          observer.disconnect();
        }
      },
      { threshold: 0.55 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <section
      ref={ref}
      className={styles.narrative}
      id="collaboration"
      aria-label="A place to think out loud, write together, and turn little ideas into something shared."
    >
      <h2>
        <span className={styles.storyLine}>
          A place to{" "}
          <a
            className={styles.inlineIcon}
            href="#experience"
            aria-label="Explore the document demo"
          >
            <FileText aria-hidden="true" />
          </a>{" "}
          think out loud,
        </span>
        <span className={styles.storyLine}>
          <UsersRound className={styles.peopleIcon} aria-hidden="true" />{" "}
          <span className={styles.annotated}>
            <button
              type="button"
              ref={trigger}
              className={styles.storyButton}
              aria-expanded={selected}
              aria-controls="story-comment"
              onClick={() => {
                ref.current?.setAttribute("data-interacted", "true");
                setSelected(!selected);
              }}
            >
              write together
            </button>
            <span
              className={`${styles.storyCursor} ${selected ? styles.storyCursorVisible : ""}`}
              aria-hidden="true"
            >
              Adam
            </span>
          </span>
          , and turn
        </span>
        <span className={styles.storyLine}>
          little ideas into something <em className={styles.shared}>shared.</em>
        </span>
      </h2>
      <div
        id="story-comment"
        className={styles.storyComment}
        hidden={!selected}
      >
        <span className={styles.commentDot} aria-hidden="true">
          L
        </span>
        <span>
          <strong>Leo</strong> What if we tried this together?
        </span>
        <span className={styles.demoTag}>Demo</span>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Close narrative comment"
          onClick={() => {
            setSelected(false);
            trigger.current?.focus();
          }}
        >
          <X aria-hidden="true" />
        </button>
      </div>
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
    <div ref={ref} className={styles.demo} data-step={step}>
      <div className={styles.editor}>
        <div className={styles.editorHeader}>
          <span className={styles.editorMark}>
            <MapleMark />
          </span>
          <span className={styles.documentName}>A place for ideas</span>
          <div
            className={styles.avatars}
            aria-label="Fictional demo collaborators: Mia, Adam, and Leo"
          >
            <span>M</span>
            <span>A</span>
            <span>L</span>
          </div>
          <button
            ref={editButton}
            className={styles.editButton}
            type="button"
            onClick={edit}
          >
            <Pencil aria-hidden="true" />
            <span>Try writing</span>
          </button>
        </div>
        <div className={styles.editorSheet}>
          <div className={styles.toolbar} aria-hidden="true">
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
          <div className={styles.document}>
            <h3>A place for ideas</h3>
            <p>
              We believe great ideas happen in the open.
              <br />
              <span className={styles.demoSelection}>
                Not in isolation, but in conversation.
                <span
                  className={`${styles.cursor} ${styles.adam} ${styles.demoAdam}`}
                  aria-hidden="true"
                >
                  Adam
                </span>
              </span>
            </p>
            {editing ? (
              <div className={styles.editArea}>
                <label className={styles.srOnly} htmlFor="demo-draft">
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
                  className={styles.saveButton}
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
              <p className={styles.draft}>
                {draft === initialDraft ? (
                  <>
                    Softmaple gives you a shared space to think, write, and{" "}
                    <span className={styles.typed}>create — together.</span>
                  </>
                ) : (
                  draft || "Your next idea starts here."
                )}
                <span
                  className={`${styles.cursor} ${styles.mia} ${styles.demoMia}`}
                  aria-hidden="true"
                >
                  Mia
                </span>
              </p>
            )}
          </div>
        </div>
        <aside className={styles.commentCard} aria-label="Demo comment">
          <div className={styles.commentAuthor}>
            <span className={styles.commentDot} aria-hidden="true">
              L
            </span>
            <strong>Leo</strong>
            <span>Demo</span>
          </div>
          <p>What if we tried this together?</p>
          {reply ? (
            <p className={styles.reply}>
              <strong>You</strong>
              <br />
              {reply}
            </p>
          ) : null}
          <button
            className={styles.replyButton}
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
      <div className={styles.demoControls}>
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
          className={styles.commentForm}
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
            <button className={styles.primary} type="submit">
              Add reply <ArrowUpRight aria-hidden="true" />
            </button>
          </div>
        </form>
      ) : null}
      <p className={styles.srOnly} role="status">
        {status}
      </p>
    </div>
  );
}
