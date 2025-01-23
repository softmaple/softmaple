import { FC, useEffect, useRef } from "react";
import type { PaletteMode } from "@mui/material";
import type { Clone } from "@/types";
import { initCalendar } from "./init-calender";
import { LightWrapper, DarkWrapper } from "../panel.style";

export type ClonesPanelProps = {
  clones: Clone[];
  mode: PaletteMode;
};

export const ClonesPanel: FC<ClonesPanelProps> = ({ clones = [], mode }) => {
  const lightWrapperRef = useRef<HTMLDivElement | null>(null);
  const darkWrapperRef = useRef<HTMLDivElement | null>(null);

  const calendarRef = mode === "dark" ? darkWrapperRef : lightWrapperRef;

  useEffect(() => {
    initCalendar(calendarRef.current, { clones, mode });
  }, [calendarRef, clones, mode]);

  return mode === "dark" ? (
    <DarkWrapper ref={darkWrapperRef} />
  ) : (
    <LightWrapper ref={lightWrapperRef} />
  );
};
