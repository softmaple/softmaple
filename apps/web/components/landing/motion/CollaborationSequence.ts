"use client";

import { animate, motionValue, type AnimationSequence } from "motion/react";
import { useEffect, type RefObject } from "react";
import { useVisiblePlayback } from "./LandingMotion";

const steps = (count: number) => (progress: number) =>
  Math.floor(progress * count) / count;

export function useCollaborationSequence(
  ref: RefObject<HTMLDivElement | null>,
  {
    run,
    automatic,
    setStep,
  }: { run: number; automatic: boolean; setStep: (step: number) => void },
) {
  const { reduced, track } = useVisiblePlayback(ref, 0.5);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Queries are scoped to this demo; edited paragraphs need not contain the
    // original phrase or Mia. Replay always preserves the user's draft/reply.
    const phrase = element.querySelector(".demo-phrase");
    const mia = element.querySelector(".demo-mia");
    const adam = element.querySelector(".demo-adam");
    const highlight = element.querySelector(".demo-highlight");
    const comment = element.querySelector(".demo-comment");
    const immediate = reduced || !automatic;
    const phase = motionValue(immediate ? 3 : 0);
    setStep(phase.get());
    const unsubscribe = phase.on("change", setStep);
    const sequence: AnimationSequence = [
      [
        phase,
        [0, 1, 2, 3],
        {
          at: 0,
          duration: 3,
          times: [0, 0.35 / 3, 1.7 / 3, 1],
          ease: steps(1),
        },
      ],
    ];
    if (mia)
      sequence.push([
        mia,
        { transform: ["translate(-45px, -10px)", "none"] },
        { at: 0.35, duration: 0.7, ease: "easeOut" },
      ]);
    if (phrase)
      sequence.push([
        phrase,
        { clipPath: ["inset(0 100% 0 0)", "inset(0 0% 0 0)"] },
        { at: 0.35, duration: 1.1, ease: steps(18) },
      ]);
    if (highlight)
      sequence.push([
        highlight,
        { transform: ["scaleX(0)", "scaleX(1)"] },
        { at: 1.7, duration: 0.65, ease: "easeOut" },
      ]);
    if (adam)
      sequence.push([
        adam,
        { opacity: [0, 1], transform: ["translateX(-35px)", "none"] },
        {
          at: 1.7,
          duration: 0.65,
          opacity: { duration: 0.25 },
          ease: "easeOut",
        },
      ]);
    if (comment)
      sequence.push([
        comment,
        {
          opacity: [0, 1],
          transform: ["translate(12px, 10px)", "none"],
          visibility: ["hidden", "visible"],
        },
        { at: 3, duration: 0.4, ease: "easeOut" },
      ]);
    const playback = animate(sequence);
    playback.pause();
    const stop = immediate ? () => playback.stop() : track(playback);
    if (immediate) playback.complete();
    return () => {
      unsubscribe();
      stop();
      phase.destroy();
    };
  }, [automatic, reduced, ref, run, setStep, track]);
}
