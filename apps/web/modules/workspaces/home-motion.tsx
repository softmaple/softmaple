"use client";

import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import {
  domAnimation,
  LazyMotion,
  m,
  MotionConfig,
  useReducedMotion,
  type HTMLMotionProps,
} from "motion/react";

const MotionLink = m.create(Link);
const pressTransition = { duration: 0.12, ease: "easeOut" } as const;

export function HomeMotion({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

/** Interaction-only feedback: no entrance animation or idle layout changes. */
export function HomeActionLink(props: ComponentProps<typeof MotionLink>) {
  const reduced = useReducedMotion();
  return (
    <MotionLink
      {...props}
      // Keep tap semantics identical during SSR and reduced-motion hydration.
      whileTap={{ scale: reduced ? 1 : 0.98 }}
      transition={pressTransition}
    />
  );
}

export function HomeAction(props: HTMLMotionProps<"button">) {
  const reduced = useReducedMotion();
  return (
    <m.button
      {...props}
      whileTap={props.disabled ? undefined : { scale: reduced ? 1 : 0.98 }}
      transition={pressTransition}
    />
  );
}
