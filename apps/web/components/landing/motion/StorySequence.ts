"use client";

import {
  useAnimate,
  type AnimationSequence,
  type SequenceOptions,
  type AnimationPlaybackControls,
} from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { useVisiblePlayback } from "./LandingMotion";

export function useStorySequence() {
  const [scope, animate] = useAnimate<HTMLElement>();
  const { reduced, visible, track } = useVisiblePlayback(scope, 0.35);
  const playback = useRef<AnimationPlaybackControls | null>(null);
  const finished = useRef(false);
  const started = useRef(false);
  const finish = useCallback(() => {
    finished.current = true;
    const controls = playback.current;
    playback.current = null;
    controls?.complete();
    if (scope.current) scope.current.dataset.entrance = "complete";
  }, [scope]);

  useEffect(() => {
    if (reduced || finished.current) return finish();
    let cancelled = false;
    const sequence: AnimationSequence = [
      [
        ".story-pin",
        { opacity: [0, 1], transform: ["scale(0.65)", "scale(1)"] },
        { at: 0.12, duration: 0.2 },
      ],
      [
        ".story-line",
        { pathLength: [0, 1] },
        { at: 0.2, duration: 0.46, ease: "easeInOut" },
      ],
      [
        ".story-note",
        { opacity: [0, 1], transform: ["translate(-6px, 5px)", "none"] },
        { at: 0.5, duration: 0.38 },
      ],
      [
        ".story-pointer",
        { opacity: [0, 1], transform: ["translate(26px, 16px)", "none"] },
        { at: 0.74, duration: 0.56 },
      ],
      [
        ".story-adam",
        { opacity: [0, 1], transform: ["translateY(4px)", "none"] },
        { at: 1.3, duration: 0.25 },
      ],
    ];
    const options: SequenceOptions = {
      defaultTransition: { ease: [0.22, 1, 0.36, 1] },
    };
    const controls = animate(sequence, options);
    controls.pause();
    void controls.finished.then(() => {
      if (cancelled) return;
      finished.current = true;
      if (playback.current === controls) playback.current = null;
      scope.current.dataset.entrance = "complete";
    });
    playback.current = controls;
    const stop = track(controls);
    return () => {
      cancelled = true;
      stop();
    };
  }, [animate, finish, reduced, scope, track]);

  useEffect(() => {
    if (finished.current) return;
    started.current ||= visible;
    scope.current.dataset.entrance = visible
      ? "playing"
      : started.current
        ? "paused"
        : "waiting";
  }, [scope, visible]);
  return { scope, finish };
}
