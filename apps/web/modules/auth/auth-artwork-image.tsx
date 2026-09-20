"use client";

import Image, { type ImageProps } from "next/image";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const desktopQuery = "(min-width: 56.25rem)";
const getDesktopSnapshot = () => window.matchMedia(desktopQuery).matches;
const getServerSnapshot = () => false;
const subscribeDesktop = (onChange: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

type AuthArtworkImageProps = Omit<ImageProps, "src" | "alt" | "loading"> & {
  readonly lightSrc: string;
  readonly darkSrc: string;
};

export function AuthArtworkImage({
  lightSrc,
  darkSrc,
  ...props
}: AuthArtworkImageProps) {
  const { resolvedTheme } = useTheme();
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    getDesktopSnapshot,
    getServerSnapshot,
  );

  // Render no source until hydration resolves the theme and visible breakpoint.
  if (!desktop || resolvedTheme === undefined) return null;

  return (
    <Image
      {...props}
      src={resolvedTheme === "dark" ? darkSrc : lightSrc}
      alt=""
      loading="lazy"
    />
  );
}
