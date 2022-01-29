import { FC, useEffect, useRef } from "react";
import type { Clone } from "@/types";
import { initCalendar } from "./init-calender";
import { LightWrapper, DarkWrapper } from "../panel.style";

export type ClonesPanelProps = {
  clones: Clone[];
  isDarkMode: boolean;
};

export const ClonesPanel: FC<ClonesPanelProps> = ({ clones, isDarkMode }) => {
  const lightWrapperRef = useRef<HTMLDivElement | null>(null);
  const darkWrapperRef = useRef<HTMLDivElement | null>(null);

  const calendarRef = isDarkMode ? darkWrapperRef : lightWrapperRef;

  useEffect(() => {
    initCalendar(calendarRef.current, { clones, isDarkMode });
  }, [calendarRef, clones, isDarkMode]);

  return isDarkMode ? (
    <DarkWrapper ref={darkWrapperRef} />
  ) : (
    <LightWrapper ref={lightWrapperRef} />
  );
};
