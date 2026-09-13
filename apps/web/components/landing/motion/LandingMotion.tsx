"use client";

import {
  MotionConfig,
  useInView,
  usePageInView,
  type AnimationPlaybackControls,
} from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";

const reducedQuery = "(prefers-reduced-motion: reduce)";
const subscribe = (notify: () => void) => {
  const media = matchMedia(reducedQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const getReduced = () => matchMedia(reducedQuery).matches;
const serverReduced = () => false;
const Preferences = createContext({ reduced: false, pageVisible: true });

export function LandingMotion({ children }: { children: ReactNode }) {
  // Subscribe explicitly: Motion's initial preference alone doesn't cover live changes.
  const reduced = useSyncExternalStore(subscribe, getReduced, serverReduced);
  const pageVisible = usePageInView();
  return (
    <Preferences.Provider value={{ reduced, pageVisible }}>
      <MotionConfig reducedMotion={reduced ? "always" : "never"}>
        {children}
      </MotionConfig>
    </Preferences.Provider>
  );
}

export const useLandingMotion = () => useContext(Preferences);

/** Only gates playback. Motion owns elapsed time, delay, pause/resume and completion. */
export function useVisiblePlayback(ref: RefObject<Element | null>, amount = 0) {
  const inView = useInView(ref, { amount });
  const { reduced, pageVisible } = useLandingMotion();
  const visible = inView && pageVisible;
  const playback = useRef<AnimationPlaybackControls | null>(null);
  const active = useRef(false);
  const sync = useCallback(() => {
    const animation = playback.current;
    if (!animation || animation.state === "finished") return;
    if (active.current && !document.hidden) animation.play();
    else animation.pause();
  }, []);
  useLayoutEffect(() => {
    active.current = visible;
    sync();
  }, [visible, sync]);
  const track = useCallback(
    (animation: AnimationPlaybackControls) => {
      playback.current = animation;
      sync();
      return () => {
        if (playback.current === animation) playback.current = null;
        animation.stop();
      };
    },
    [sync],
  );
  useEffect(
    () => () => {
      playback.current?.stop();
      playback.current = null;
    },
    [],
  );
  return { reduced, visible, track };
}
