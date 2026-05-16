import { OPERATION_TYPE } from "../../constants/operation-types";
import { parseEventId } from "../../graph/event-id";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import type { IndexedSequence } from "../indexed-sequence";
import type { AugmentedCRDTItem, TypedRun } from "./engine-types";
import { OriginLeftIndex } from "./origin-left-index";
import { PendingInsertBuffer } from "./pending-insert-buffer";
import { RecordSplitter } from "./record-splitter";
import { spliceText, stringCodeUnits } from "./text-utils";
import { findIntegrationPosition } from "./yata-integration";

type InsertOperation = Extract<
  ExternalOperation,
  { type: typeof OPERATION_TYPE.INSERT }
>;

export interface InsertHandlerDeps {
  readonly sequence: IndexedSequence<AugmentedCRDTItem>;
  readonly itemsById: Map<EventId, AugmentedCRDTItem>;
  readonly eventItems: Map<EventId, EventId[]>;
  readonly originLeftIndex: OriginLeftIndex;
  readonly recordSplitter: RecordSplitter;
  readonly pendingInsert: PendingInsertBuffer;
  readonly applyPendingSplice: (effectIndex: number, text: string) => void;
  readonly flushPendingInsert: () => void;
  readonly itemToEffectIndex: (target: AugmentedCRDTItem) => number;
  readonly requireItem: (itemId: EventId) => AugmentedCRDTItem;
  readonly getResultingText: () => string;
  readonly setResultingText: (text: string) => void;
}

export const applyInsert = (
  event: GraphEvent,
  operation: InsertOperation,
  deps: InsertHandlerDeps,
): ExternalOperation[] => {
  const {
    sequence,
    itemsById,
    eventItems,
    originLeftIndex,
    recordSplitter,
    pendingInsert,
    applyPendingSplice,
    flushPendingInsert,
    itemToEffectIndex,
    requireItem,
    getResultingText,
    setResultingText,
  } = deps;

  if (operation.text.length === 0) {
    eventItems.set(event.id, []);
    return [];
  }

  const landing = sequence.prepareIndexToPositionAndOffset(
    operation.index,
    true,
  );
  const firstInsertPosition =
    landing.offsetInRecord > 0
      ? recordSplitter.splitRecordAt(landing.position, landing.offsetInRecord)
      : landing.position;
  const originLeftPosition =
    sequence.previousPrepareVisiblePosition(firstInsertPosition);
  const originLeft =
    originLeftPosition === null
      ? null
      : (sequence.at(originLeftPosition)?.id ?? null);
  const originRightPosition =
    sequence.nextPrepareVisiblePosition(firstInsertPosition);
  const originRight =
    originRightPosition === null
      ? null
      : (sequence.at(originRightPosition)?.id ?? null);

  const leftBound = originLeftPosition ?? -1;
  const rightBound = originRightPosition ?? sequence.length;
  const conflictRegionEmpty =
    leftBound + 1 === firstInsertPosition && firstInsertPosition === rightBound;

  const parsed = parseEventId(event.id);
  if (
    conflictRegionEmpty &&
    operation.text.length === 1 &&
    parsed !== null &&
    originLeftPosition !== null &&
    originLeftPosition === firstInsertPosition - 1
  ) {
    const leftRecord = sequence.at(originLeftPosition);
    if (
      leftRecord !== undefined &&
      leftRecord.run !== null &&
      leftRecord.run.replicaId === parsed.replicaId &&
      leftRecord.run.startSequence + leftRecord.content.length ===
        parsed.sequence &&
      leftRecord.prepareState === 1 &&
      !leftRecord.everDeleted &&
      !originLeftIndex.has(leftRecord.id)
    ) {
      const effectIndex =
        itemToEffectIndex(leftRecord) + leftRecord.content.length;
      leftRecord.content += operation.text;
      sequence.updateItem(leftRecord);
      eventItems.set(event.id, [leftRecord.id]);
      pendingInsert.append(effectIndex, operation.text, applyPendingSplice);

      return [
        {
          type: OPERATION_TYPE.INSERT,
          index: effectIndex,
          text: operation.text,
        },
      ];
    }
  }

  const codeUnits = stringCodeUnits(operation.text);
  const insertedIds: EventId[] = [];
  let left = originLeft;

  const firstRun: TypedRun | null =
    parsed !== null && operation.text.length === 1
      ? { replicaId: parsed.replicaId, startSequence: parsed.sequence }
      : null;
  const firstItem: AugmentedCRDTItem = {
    id: `${event.id}:0`,
    eventId: event.id,
    content: codeUnits[0] ?? "",
    originLeft: left,
    originRight,
    everDeleted: false,
    prepareState: 1,
    run: firstRun,
  };
  let actualFirstPosition: number;
  if (conflictRegionEmpty) {
    actualFirstPosition = firstInsertPosition;
    sequence.insert(actualFirstPosition, firstItem);
  } else {
    actualFirstPosition = findIntegrationPosition(
      firstItem,
      sequence,
      itemsById,
    );
    sequence.insert(actualFirstPosition, firstItem);
  }
  itemsById.set(firstItem.id, firstItem);
  originLeftIndex.track(firstItem.id, firstItem.originLeft);
  insertedIds.push(firstItem.id);
  left = firstItem.id;

  for (let offset = 1; offset < codeUnits.length; offset++) {
    const item: AugmentedCRDTItem = {
      id: `${event.id}:${offset}`,
      eventId: event.id,
      content: codeUnits[offset] ?? "",
      originLeft: left,
      originRight,
      everDeleted: false,
      prepareState: 1,
      run: null,
    };
    sequence.insert(actualFirstPosition + offset, item);
    itemsById.set(item.id, item);
    originLeftIndex.track(item.id, item.originLeft);
    insertedIds.push(item.id);
    left = item.id;
  }

  eventItems.set(event.id, insertedIds);

  const firstInserted = requireItem(insertedIds[0] ?? event.id);
  const effectIndex = itemToEffectIndex(firstInserted);
  if (!pendingInsert.isEmpty()) {
    flushPendingInsert();
  }
  setResultingText(spliceText(getResultingText(), effectIndex, operation.text));

  return [
    {
      type: OPERATION_TYPE.INSERT,
      index: effectIndex,
      text: operation.text,
    },
  ];
};
