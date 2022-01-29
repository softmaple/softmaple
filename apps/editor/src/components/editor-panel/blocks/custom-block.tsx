import dynamic from "next/dynamic";
import { FC } from "react";
import type { CustomBlockType } from "./types";

const MathEquation = dynamic(() =>
  import("./math/math-equation").then((mod) => mod.MathEquation)
);

export const CustomBlock: FC<CustomBlockType> = ({
  block,
  contentState,
  blockProps,
}) => {
  const entity = contentState.getEntity(block.getEntityAt(0));
  const type = entity.getType();

  switch (type) {
    case "MATH":
      return (
        <MathEquation
          block={block}
          contentState={contentState}
          blockProps={blockProps}
        />
      );

    default:
      break;
  }
};
