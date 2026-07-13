import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { OPERATION_TYPE } from "../../constants/operation-types";
import { EgWalkerReplica } from "../../core/replica";
import { ColumnarEventGraphCodec } from "../../graph/columnar-codec";
import { EventGraph } from "../../graph/event-graph";
import type { ExternalOperation } from "../../types";
import { surrogateBiasedTextArb } from "./arbitraries";
import { fcParams } from "./run-config";

type LinearInstruction =
  | {
      readonly kind: "insert";
      readonly positionSeed: number;
      readonly text: string;
    }
  | {
      readonly kind: "delete";
      readonly positionSeed: number;
      readonly lengthSeed: number;
    };

const linearInstructionArb: fc.Arbitrary<LinearInstruction> = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("insert" as const),
      positionSeed: fc.nat(),
      text: fc.oneof(fc.constant(""), surrogateBiasedTextArb()),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("delete" as const),
      positionSeed: fc.nat(),
      lengthSeed: fc.nat(),
    }),
  },
);

describe("property: packed exact-linear replay", () => {
  it("should match ordinary replay for every valid UTF-16 edit script", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("", "a🙂e\u0301", "👩‍💻"),
        fc.array(linearInstructionArb, { minLength: 33, size: "-1" }),
        (initialText, instructions) => {
          // Arrange
          const graph = buildLinearGraph(initialText, instructions);
          const graphCodec = new ColumnarEventGraphCodec();
          const packedGraph = graphCodec.decodeBinary(
            graphCodec.encodeBinary(graph),
          );

          // Act
          const ordinary = new EgWalkerReplica("ordinary", initialText, graph);
          const packed = new EgWalkerReplica(
            "packed",
            initialText,
            packedGraph,
          );

          // Assert
          expect(packed.getText()).toBe(ordinary.getText());
          expect(packed.exportEventGraph()).toEqual(
            ordinary.exportEventGraph(),
          );
          expect(packed.getReplayStats().checkpointCount).toBe(
            ordinary.getReplayStats().checkpointCount,
          );
        },
      ),
      fcParams(),
    );
  });
});

// Helpers

const buildLinearGraph = (
  initialText: string,
  instructions: ReadonlyArray<LinearInstruction>,
): EventGraph => {
  const graph = new EventGraph();
  const scalars = Array.from(initialText);

  for (const [offset, instruction] of instructions.entries()) {
    const operation = resolveInstruction(scalars, instruction);
    graph.addEvent({
      id: `linear:${offset}`,
      parentVersion:
        offset === 0 ? new Set() : new Set([`linear:${offset - 1}`]),
      operation,
      timestamp: offset,
    });
  }

  return graph;
};

const resolveInstruction = (
  scalars: string[],
  instruction: LinearInstruction,
): ExternalOperation => {
  const scalarIndex = instruction.positionSeed % (scalars.length + 1);
  const utf16Index = scalars.slice(0, scalarIndex).join("").length;

  if (instruction.kind === "insert") {
    scalars.splice(scalarIndex, 0, ...Array.from(instruction.text));
    return {
      type: OPERATION_TYPE.INSERT,
      index: utf16Index,
      text: instruction.text,
    };
  }

  const remainingScalars = scalars.length - scalarIndex;
  const scalarLength = instruction.lengthSeed % (remainingScalars + 1);
  const utf16Length = scalars
    .slice(scalarIndex, scalarIndex + scalarLength)
    .join("").length;
  scalars.splice(scalarIndex, scalarLength);
  return {
    type: OPERATION_TYPE.DELETE,
    index: utf16Index,
    length: utf16Length,
  };
};
