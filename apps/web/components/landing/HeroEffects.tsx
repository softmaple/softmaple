"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import { createPaperGlow } from "./paper-glow";

const BrushContext = createContext({ complete: false, finish: () => {} });

export function HeroEffects({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const [complete, setComplete] = useState(false);
  const finish = useCallback(() => setComplete(true), []);
  return (
    <BrushContext.Provider value={{ complete, finish }}>
      <div className={className}>{children}</div>
    </BrushContext.Provider>
  );
}

/** A finite foreground clock: hidden/offscreen time never accrues. */
function visibleTimeline(
  target: Element,
  duration: number,
  update: (elapsed: number) => void,
  finish: () => void,
) {
  let frame = 0;
  let elapsed = 0;
  let previous: number | undefined;
  let visible = false;
  let done = false;
  const tick = (now: number) => {
    frame = 0;
    if (previous !== undefined) elapsed += now - previous;
    previous = now;
    update(Math.min(elapsed, duration));
    if (elapsed >= duration) {
      done = true;
      finish();
    } else frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    previous = undefined;
    if (visible && !document.hidden && !done)
      frame = requestAnimationFrame(tick);
  };
  const observer = new IntersectionObserver(([entry]) => {
    visible = Boolean(entry?.isIntersecting);
    sync();
  });
  observer.observe(target);
  document.addEventListener("visibilitychange", sync);
  return () => {
    done = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener("visibilitychange", sync);
  };
}

export function TogetherBrush() {
  const ref = useRef<HTMLSpanElement>(null);
  const { finish } = useContext(BrushContext);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let stop = () => {};
    const complete = () => {
      element.style.clipPath = "none";
      element.dataset.brush = "complete";
      finish();
    };
    const preference = () => {
      if (media.matches) {
        stop();
        complete();
      }
    };
    if (media.matches) complete();
    else {
      stop = visibleTimeline(
        element.parentElement ?? element,
        1250,
        (time) => {
          const progress = Math.max(0, (time - 450) / 800);
          // A slightly slanted reveal front; the painted SVG never scales.
          const eased = progress * progress * (3 - 2 * progress);
          const edge = -12 + eased * 124;
          element.style.clipPath = `polygon(0 0, ${edge}% 0, ${edge - 9}% 100%, 0 100%)`;
          element.dataset.brush = time < 450 ? "waiting" : "painting";
        },
        complete,
      );
    }
    media.addEventListener("change", preference);
    return () => {
      stop();
      media.removeEventListener("change", preference);
    };
  }, [finish]);
  return (
    <span className="relative isolate inline-block whitespace-nowrap text-[#0c0c0b] dark:text-[#f6f5f0]">
      <span
        ref={ref}
        className="landing-brush dark:opacity-35 pointer-events-none absolute -z-1 -left-[0.055em] -right-[0.08em] top-[0.01em] bottom-[-0.09em]"
        aria-hidden="true"
        data-brush="waiting"
      />
      together.
    </span>
  );
}

export function PaperGlow() {
  const ref = useRef<HTMLCanvasElement>(null);
  const { complete } = useContext(BrushContext);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !complete) return;
    const abort = new AbortController();
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let dispose = () => {};
    let stop = () => {};
    let resize: ResizeObserver | undefined;
    let strength = 0.28;
    let draw: (strength: number) => void = () => {};
    const preference = () => {
      if (media.matches) {
        stop();
        strength = 0.28;
        draw(strength);
        canvas.dataset.glow = "settled";
      }
    };
    const lost = (event: Event) => {
      event.preventDefault();
      abort.abort();
      stop();
      resize?.disconnect();
      dispose();
      canvas.style.visibility = "hidden";
      canvas.dataset.glow = "fallback";
    };
    canvas.addEventListener("webglcontextlost", lost);
    media.addEventListener("change", preference);
    void createPaperGlow(canvas, abort.signal).then((renderer) => {
      if (!renderer) {
        if (!abort.signal.aborted) canvas.dataset.glow = "fallback";
        return;
      }
      dispose = renderer.dispose;
      if (abort.signal.aborted) return dispose();
      draw = renderer.draw;
      resize = new ResizeObserver(() => draw(strength));
      resize.observe(canvas);
      draw(strength);
      if (media.matches) canvas.dataset.glow = "settled";
      else {
        canvas.dataset.glow = "illuminating";
        stop = visibleTimeline(
          canvas,
          2000,
          (time) => {
            // One soft arrival of light, returning smoothly to a quiet baseline.
            strength = 0.28 + 0.72 * Math.sin((Math.PI * time) / 2000) ** 2;
            draw(strength);
          },
          () => {
            canvas.dataset.glow = "settled";
          },
        );
      }
    });
    return () => {
      abort.abort();
      stop();
      resize?.disconnect();
      media.removeEventListener("change", preference);
      canvas.removeEventListener("webglcontextlost", lost);
      dispose();
    };
  }, [complete]);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      data-glow="waiting"
      className="pointer-events-none absolute inset-0 h-full w-full dark:opacity-40"
    />
  );
}

export function DecorativeMaple({ position }: { position: "hero" | "story" }) {
  return (
    <Image
      src="/landing/veined-maple.webp"
      alt=""
      width={1297}
      height={1213}
      loading={position === "hero" ? "eager" : "lazy"}
      sizes={`(width < 768px) 110px, (width < 1200px) 180px, ${position === "hero" ? 240 : 235}px`}
      className={
        position === "hero"
          ? "pointer-events-none absolute left-[-45px] top-[54%] w-[240px] h-auto opacity-65 -rotate-12 max-[1200px]:w-[180px] max-[768px]:w-[110px] max-[768px]:left-[-35px] max-[768px]:top-[48%] max-[361px]:hidden"
          : "pointer-events-none absolute right-[-100px] top-[-5px] w-[235px] h-auto opacity-60 rotate-[155deg] max-[1200px]:w-[180px] max-[768px]:w-[110px] max-[768px]:right-[-66px] max-[768px]:top-[-8px] max-[361px]:hidden"
      }
    />
  );
}
