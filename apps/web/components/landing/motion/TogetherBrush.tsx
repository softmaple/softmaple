"use client";

import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useContext, useEffect, useRef } from "react";
import { BrushContext } from "../HeroEffects";
import { useVisiblePlayback } from "./LandingMotion";

export function TogetherBrush() {
  const ref = useRef<HTMLSpanElement>(null);
  const visibilityRef = useRef<HTMLSpanElement>(null);
  const { complete: brushComplete, finish } = useContext(BrushContext);
  const progress = useMotionValue(0);
  const clipPath = useTransform(
    progress,
    [0, 1],
    [
      "polygon(0 0, -12% 0, -21% 100%, 0 100%)",
      "polygon(0 0, 112% 0, 103% 100%, 0 100%)",
    ],
  );
  // Observe readable text, not the changing clip mask that is being revealed.
  const { reduced, track } = useVisiblePlayback(visibilityRef);
  const finished = useRef(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const complete = () => {
      finished.current = true;
      element.dataset.brush = "complete";
      finish();
    };
    if (reduced || finished.current) return complete();
    element.dataset.brush = "waiting";
    progress.set(0);
    const playback = animate(progress, 1, {
      autoplay: false,
      delay: 0.45,
      duration: 0.8,
      ease: (progress) => progress * progress * (3 - 2 * progress),
      onUpdate: (latest) => {
        if (latest > 0 && element.dataset.brush === "waiting") {
          element.dataset.brush = "painting";
        }
      },
      onComplete: complete,
    });
    return track(playback);
  }, [finish, progress, reduced, track]);
  return (
    <span
      ref={visibilityRef}
      className="relative isolate inline-block whitespace-nowrap text-[#0c0c0b] dark:text-[#f6f5f0]"
    >
      <motion.span
        ref={ref}
        style={{ clipPath: brushComplete || reduced ? "none" : clipPath }}
        className="landing-brush dark:opacity-35 pointer-events-none absolute -z-1 -left-[0.055em] -right-[0.08em] top-[0.01em] bottom-[-0.09em]"
        aria-hidden="true"
        data-brush="waiting"
      />
      together.
    </span>
  );
}
