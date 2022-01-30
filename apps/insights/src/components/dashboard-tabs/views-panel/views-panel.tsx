import { FC, useRef, useEffect } from "react";
import type { PaletteMode } from "@mui/material";
import type { View } from "@/types";
import { initLineChart } from "./init-line-chart";
import { LightWrapper, DarkWrapper } from "../panel.style";

export type ViewsPanelProps = {
  views: View[];
  mode: PaletteMode;
};

export const ViewsPanel: FC<ViewsPanelProps> = ({ views, mode }) => {
  const lightWrapperRef = useRef<HTMLDivElement | null>(null);
  const darkWrapperRef = useRef<HTMLDivElement | null>(null);

  const lineChartRef = mode === "dark" ? darkWrapperRef : lightWrapperRef;

  useEffect(() => {
    initLineChart(lineChartRef.current, { views, mode });
  }, [lineChartRef, views, mode]);

  return mode === "dark" ? (
    <DarkWrapper ref={darkWrapperRef} />
  ) : (
    <LightWrapper ref={lightWrapperRef} />
  );
};
