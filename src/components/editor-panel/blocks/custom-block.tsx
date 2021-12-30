import { FC } from "react";
import { MathEquation } from "./math/math-equation";
import type { CustomBlockType } from "./types";

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
