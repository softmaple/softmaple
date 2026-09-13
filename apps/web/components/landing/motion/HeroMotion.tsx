"use client";

import {
  motion,
  useAnimate,
  useInView,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@softmaple/ui/lib/utils";
import { useLandingMotion } from "./LandingMotion";

const Unfold = createContext<{
  progress: MotionValue<number>;
  active: boolean;
} | null>(null);
function useUnfold() {
  const progress = useContext(Unfold);
  if (!progress) throw new Error("Paper artwork must be inside HeroMotion");
  return progress;
}

// These independent first-screen fades retain their original durations and do
// not hide server-rendered copy. CSS supplies only the pre-hydration fallback.
function useHeroEntrance(copy: boolean) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const { reduced } = useLandingMotion();
  const finished = useRef(false);
  useEffect(() => {
    const element = scope.current;
    if (reduced || finished.current) {
      element.style.opacity = "1";
      element.style.transform = "none";
      element.dataset.heroEntrance = "complete";
      return;
    }
    element.dataset.heroEntrance = "playing";
    const controls = animate(
      element,
      copy
        ? { opacity: [0, 1], transform: ["translateY(12px)", "none"] }
        : { opacity: [0, 1] },
      {
        duration: copy ? 0.85 : 1.1,
        ease: "easeOut",
        onComplete: () => {
          finished.current = true;
          element.dataset.heroEntrance = "complete";
        },
      },
    );
    return () => controls.stop();
  }, [animate, copy, reduced, scope]);
  return scope;
}

export function HeroMotion({ children }: { children: ReactNode }) {
  const ref = useHeroEntrance(false);
  const { reduced, pageVisible } = useLandingMotion();
  const inView = useInView(ref);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const media = matchMedia("(min-width: 1024px)");
    const sync = () => setDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "0.75 start"],
  });
  const progress = useTransform(
    scrollYProgress,
    [0, 1],
    [0, desktop && !reduced ? 1 : 0],
  );
  return (
    <Unfold.Provider
      value={{ progress, active: desktop && !reduced && inView && pageVisible }}
    >
      <div
        ref={ref}
        data-hero-entrance="waiting"
        className={cn(
          "landing-art absolute inset-0 -z-1 [container-type:inline-size]",
          "min-[1600px]:max-w-[1600px] min-[1600px]:m-auto",
          "min-[768px]:max-[1024px]:top-auto min-[768px]:max-[1024px]:bottom-0 min-[768px]:max-[1024px]:h-auto",
          "min-[768px]:max-[1024px]:aspect-[4_/_3]",
          "max-[768px]:top-auto max-[768px]:bottom-[30px] max-[768px]:left-[-33%] max-[768px]:w-[138%] max-[768px]:h-auto",
          "max-[768px]:aspect-[4_/_3]",
        )}
      >
        {children}
      </div>
    </Unfold.Provider>
  );
}

export function PaperArtwork({ children }: { children: ReactNode }) {
  const { progress, active } = useUnfold();
  const y = useTransform(progress, [0, 1], [0, -32]);
  const opacity = useTransform(progress, [0, 1], [1, 0.75]);
  return (
    <motion.div
      className="absolute inset-0"
      style={{ y, opacity, willChange: active ? "transform, opacity" : "auto" }}
    >
      {children}
    </motion.div>
  );
}

export function PaperNote({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const { progress, active } = useUnfold();
  const y = useTransform(progress, [0, 1], [0, -24]);
  const rotate = useTransform(progress, [0, 1], [12, 2]);
  const opacity = useTransform(progress, [0, 1], [0, 0.9]);
  return (
    <motion.div
      className={className}
      style={{ y, rotate, willChange: active ? "transform" : "auto" }}
    >
      <motion.span
        aria-hidden="true"
        className="absolute -inset-x-8 -inset-y-[25px] -z-1 bg-[#fffefc] border border-[#d6d6d4] shadow-[0_14px_40px_#1a191014] dark:bg-[#282923] dark:border-[#626357]"
        style={{ opacity }}
      />
      {children}
    </motion.div>
  );
}

export function HeroCopy({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const ref = useHeroEntrance(true);
  return (
    <div
      ref={ref}
      data-hero-entrance="waiting"
      className={cn("landing-copy", className)}
    >
      {children}
    </div>
  );
}
