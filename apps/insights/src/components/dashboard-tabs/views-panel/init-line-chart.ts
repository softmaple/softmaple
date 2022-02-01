import * as echarts from "echarts/core";
import {
  TitleComponent,
  TitleComponentOption,
  TooltipComponent,
  TooltipComponentOption,
  GridComponent,
  GridComponentOption,
} from "echarts/components";
import { LineChart, LineSeriesOption } from "echarts/charts";
import { UniversalTransition } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";
import type { ViewsPanelProps } from "./views-panel";
import { getChartsData } from "../utils/get-charts-data";
import { RepoType } from "@/types";

echarts.use([
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LineChart,
  CanvasRenderer,
  UniversalTransition,
]);

type EChartsOption = echarts.ComposeOption<
  | TitleComponentOption
  | TooltipComponentOption
  | GridComponentOption
  | LineSeriesOption
>;

export const initLineChart = (
  chartDom: HTMLDivElement,
  { views, mode }: ViewsPanelProps
) => {
  const myChart = echarts.init(chartDom, mode);

  const option: EChartsOption = {
    title: {
      left: "center",
      text: RepoType.EDITOR,
      backgroundColor: "rgb(223,157,131)",
      link: "https://github.com/softmaple/softmaple/",
    },
    xAxis: {
      type: "category",
    },
    yAxis: {
      type: "value",
    },
    series: {
      type: "line",
      data: getChartsData(views),
    },
    tooltip: {},
  };

  option && myChart.setOption(option);
};
