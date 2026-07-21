import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DeleteTargetIndex } from "../../engine/internals/delete-target-index";
import { fcParams } from "./run-config";

type PackedDeleteTargetInstruction = {
  readonly commitPriority: number;
  readonly kind: "empty" | "item" | "run";
};

const packedDeleteTargetInstructionArb: fc.Arbitrary<PackedDeleteTargetInstruction> =
  fc.record({
    commitPriority: fc.nat(),
    kind: fc.constantFrom("empty" as const, "item" as const, "run" as const),
  });

describe("property: packed delete-target indexing", () => {
  it("materializes out-of-order numeric keys in replay order", () => {
    fc.assert(
      fc.property(
        fc.array(packedDeleteTargetInstructionArb),
        (instructions) => {
          const startOrderIndex = 37;
          const index = new DeleteTargetIndex();
          index.configurePackedOrderRange(
            startOrderIndex,
            startOrderIndex + instructions.length,
          );

          const commitOrder = instructions
            .map((instruction, relativeIndex) => ({
              instruction,
              relativeIndex,
            }))
            .sort(
              (left, right) =>
                left.instruction.commitPriority -
                  right.instruction.commitPriority ||
                left.relativeIndex - right.relativeIndex,
            );

          for (const { instruction, relativeIndex } of commitOrder) {
            const orderIndex = startOrderIndex + relativeIndex;
            if (instruction.kind === "empty") {
              continue;
            }
            if (instruction.kind === "run") {
              index.recordPackedRunEvent(
                orderIndex,
                `target-event:${relativeIndex}`,
              );
              continue;
            }
            const group = index.beginRecord();
            index.appendItem(group, `target-item:${relativeIndex}`);
            index.commitPackedRecord(orderIndex, group);
          }

          expect(index.entries()).toEqual([]);
          for (
            let relativeIndex = 0;
            relativeIndex < instructions.length;
            relativeIndex++
          ) {
            index.materializeRunEventTargetsOfPackedOrder(
              startOrderIndex + relativeIndex,
              (eventId) => `${eventId}:resolved`,
            );
          }
          index.materializePackedRecords(
            (orderIndex) => `delete:${orderIndex}`,
          );

          expect(index.hasPackedRecords()).toBe(false);
          expect(index.hasPackedOrderRange()).toBe(false);
          expect(index.entries()).toEqual(
            instructions.flatMap((instruction, relativeIndex) =>
              instruction.kind === "empty"
                ? []
                : [
                    {
                      deleteEventId: `delete:${startOrderIndex + relativeIndex}`,
                      targetIds: [
                        instruction.kind === "run"
                          ? `target-event:${relativeIndex}:resolved`
                          : `target-item:${relativeIndex}`,
                      ],
                    },
                  ],
            ),
          );
        },
      ),
      fcParams(),
    );
  });
});
