import { FC, useRef, useEffect } from "react";
import type { View } from "@/types";
import { initLineChart } from "./init-line-chart";
import { LightWrapper, DarkWrapper } from "../panel.style";

export type ViewsPanelProps = {
  views: View[];
  isDarkMode: boolean;
};

export const ViewsPanel: FC<ViewsPanelProps> = ({ views, isDarkMode }) => {
  const lightWrapperRef = useRef<HTMLDivElement | null>(null);
  const darkWrapperRef = useRef<HTMLDivElement | null>(null);

  const lineChartRef = isDarkMode ? darkWrapperRef : lightWrapperRef;

  useEffect(() => {
    initLineChart(lineChartRef.current, { views, isDarkMode });
  }, [lineChartRef, views, isDarkMode]);

  return isDarkMode ? (
    <DarkWrapper ref={darkWrapperRef} />
  ) : (
    <LightWrapper ref={lightWrapperRef} />
  );
};
