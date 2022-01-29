import * as echarts from "echarts/core";
import type { Clone, View } from "@/types";

type Field = Clone | View;

export function getChartsData(sample: Array<Field>) {
  let data = [];

  sample.forEach((field: Field) =>
    data.push([
      echarts.time.format(field.timestamp, "{yyyy}-{MM}-{dd}", true),
      field.count,
    ])
  );

  return data;
}
