"use client";

import { createContext, useCallback, useState, type ReactNode } from "react";
import Image from "next/image";
import { LandingMotion } from "./motion/LandingMotion";

export const BrushContext = createContext({
  complete: false,
  finish: () => {},
});

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
    <LandingMotion>
      <BrushContext.Provider value={{ complete, finish }}>
        <div className={className}>{children}</div>
      </BrushContext.Provider>
    </LandingMotion>
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
