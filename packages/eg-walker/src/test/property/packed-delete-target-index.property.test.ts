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

const RUN_AGENT = 3;
const TARGET_ITEM_BASE = 1;
const RESOLVED_ITEM_BASE = 1_000_000;
const DELETE_EVENT_BASE = 2_000_000;
const formatItem = (itemId: number): string =>
  itemId >= RESOLVED_ITEM_BASE
    ? `resolved:${itemId - RESOLVED_ITEM_BASE}`
    : `target-item:${itemId - TARGET_ITEM_BASE}`;

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
              index.recordPackedRunEvent(orderIndex, RUN_AGENT, relativeIndex);
              continue;
            }
            const group = index.beginRecord();
            index.appendItem(group, TARGET_ITEM_BASE + relativeIndex);
            index.commitPackedRecord(orderIndex, group);
          }

          expect(index.entries(formatItem)).toEqual([]);
          for (
            let relativeIndex = 0;
            relativeIndex < instructions.length;
            relativeIndex++
          ) {
            index.materializeRunEventTargetsOfPackedOrder(
              startOrderIndex + relativeIndex,
              (agent, sequence) => {
                expect(agent).toBe(RUN_AGENT);
                return RESOLVED_ITEM_BASE + sequence;
              },
            );
          }
          index.materializePackedRecords(
            (orderIndex) => DELETE_EVENT_BASE + orderIndex,
          );

          expect(index.hasPackedRecords()).toBe(false);
          expect(index.hasPackedOrderRange()).toBe(false);
          expect(index.entries(formatItem)).toEqual(
            instructions.flatMap((instruction, relativeIndex) =>
              instruction.kind === "empty"
                ? []
                : [
                    {
                      deleteEvent:
                        DELETE_EVENT_BASE + startOrderIndex + relativeIndex,
                      targetIds: [
                        instruction.kind === "run"
                          ? `resolved:${relativeIndex}`
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
