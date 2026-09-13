"use client";

import { animate } from "motion/react";
import { useContext, useEffect, useRef } from "react";
import { BrushContext } from "../HeroEffects";
import { createPaperGlow } from "../paper-glow";
import { useVisiblePlayback } from "../motion/LandingMotion";

export function PaperGlow() {
  const ref = useRef<HTMLCanvasElement>(null);
  const { complete } = useContext(BrushContext);
  const { reduced, track } = useVisiblePlayback(ref);
  const settled = useRef(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !complete) return;
    const abort = new AbortController();
    let dispose = () => {};
    let stop = () => {};
    let resize: ResizeObserver | undefined;
    let strength = 0.28;
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
    void createPaperGlow(canvas, abort.signal).then((renderer) => {
      if (!renderer) {
        if (!abort.signal.aborted) canvas.dataset.glow = "fallback";
        return;
      }
      dispose = renderer.dispose;
      if (abort.signal.aborted) return dispose();
      const { draw } = renderer;
      resize = new ResizeObserver(() => draw(strength));
      resize.observe(canvas);
      draw(strength);
      if (reduced || settled.current) {
        settled.current = true;
        canvas.dataset.glow = "settled";
        return;
      }
      canvas.dataset.glow = "illuminating";
      const playback = animate(0, 1, {
        autoplay: false,
        duration: 2,
        ease: "linear",
        onUpdate: (progress) => {
          strength = 0.28 + 0.72 * Math.sin(Math.PI * progress) ** 2;
          draw(strength);
        },
        onComplete: () => {
          settled.current = true;
          canvas.dataset.glow = "settled";
        },
      });
      stop = track(playback);
    });
    return () => {
      abort.abort();
      stop();
      resize?.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      dispose();
    };
  }, [complete, reduced, track]);
  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      data-glow="waiting"
      className="pointer-events-none absolute inset-0 h-full w-full dark:opacity-40"
    />
  );
}
