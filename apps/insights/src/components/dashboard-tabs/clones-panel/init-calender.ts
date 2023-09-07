import * as echarts from "echarts/core";
import {
  TitleComponent,
  TitleComponentOption,
  CalendarComponent,
  CalendarComponentOption,
  TooltipComponent,
  TooltipComponentOption,
  VisualMapComponent,
  VisualMapComponentOption,
} from "echarts/components";
import { HeatmapChart, HeatmapSeriesOption } from "echarts/charts";
import { CanvasRenderer } from "echarts/renderers";
import type { ClonesPanelProps } from "./clones-panel";
import { RepoType } from "@/types";
import { getChartsData } from "../utils/get-charts-data";

echarts.use([
  TitleComponent,
  CalendarComponent,
  TooltipComponent,
  VisualMapComponent,
  HeatmapChart,
  CanvasRenderer,
]);

type EChartsOption = echarts.ComposeOption<
  | TitleComponentOption
  | CalendarComponentOption
  | TooltipComponentOption
  | VisualMapComponentOption
  | HeatmapSeriesOption
>;

/**
 * Init Echarts Heatmap Calendar
 *
 * @param chartDom HTMLDivElement
 * @param param1 HeatmapCalendarProps
 */
export const initCalendar = (
  chartDom: HTMLDivElement,
  { clones, mode }: ClonesPanelProps
) => {
  const myChart = echarts.init(chartDom, mode);

  const max = Math.max(...clones.map((clone) => clone.count));

  /**
   * the default color from echarts is good (maple leaf color)
   */
  const option: EChartsOption = {
    title: [
      {
        top: 0,
        left: "center",
        text: RepoType.EDITOR,
        backgroundColor: "rgb(223,157,131)",
        link: "https://github.com/softmaple/softmaple/",
      },
    ],
    tooltip: {},
    visualMap: {
      show: false,
      min: 0,
      max,
      orient: "horizontal",
    },
    calendar: [
      {
        range: ["2021-12-25", "2023-12-31"],
        cellSize: ["auto", 10],
      },
    ],
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: getChartsData(clones),
      },
    ],
  };

  option && myChart.setOption(option);
};
