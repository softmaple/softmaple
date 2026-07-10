import { parseEventId } from "../../graph/event-id";
import type { EventId } from "../../types";
import type { IndexedSequence } from "../indexed-sequence";
import { DeleteTargetIndex } from "./delete-target-index";
import { PLACEHOLDER_EVENT_ID, type AugmentedCRDTItem } from "./engine-types";
import { EventItemIndex } from "./event-item-index";
import { OriginLeftIndex } from "./origin-left-index";

interface RecordSplitterDeps {
  readonly sequence: IndexedSequence<AugmentedCRDTItem>;
  readonly itemsById: Map<EventId, AugmentedCRDTItem>;
  readonly eventItems: EventItemIndex;
  readonly originLeftIndex: OriginLeftIndex;
  readonly deleteTargets: DeleteTargetIndex;
  readonly nextPlaceholderId: () => EventId;
  readonly onRecordSplit?: (
    left: AugmentedCRDTItem,
    right: AugmentedCRDTItem,
  ) => void;
}

/**
 * On-demand split of run-length records (placeholders and typed-run
 * leaves) when concurrent inserts or deletes anchor inside them.
 *
 * The splitter owns no state of its own; it mutates the sequence and
 * cross-reference indices wired in via {@link RecordSplitterDeps}.
 * Keeping it as a separate object lets the engine compose the run-length
 * "smaller" lever (Section 3.4) with the YATA integration scan without
 * either side having to know about the other's bookkeeping.
 */
export class RecordSplitter {
  constructor(private readonly deps: RecordSplitterDeps) {}

  /**
   * Split a multi-character record so that `offsetInRecord` code units
   * remain in place and the rest become a new record at `position + 1`.
   * Returns the position of the new right-hand record — i.e. where neighbours
   * sandwiched between the two halves should be inserted. Single-character
   * records and offset-0 calls are no-ops.
   *
   * Two record shapes carry multi-character content and can be split:
   *
   * - **Placeholder:** right gets a fresh placeholder id; both halves stay
   *   anonymous, owned by the engine-internal `PLACEHOLDER_EVENT_ID`.
   * - **Typed-run record:** right inherits the run's replicaId with
   *   `startSequence` advanced by `offsetInRecord`, and the `eventItems`
   *   entry for every event whose sequence moved to the right half is
   *   repointed from `left.id` to `right.id` so retreat / advance still
   *   land on the right slice.
   */
  splitRecordAt(position: number, offsetInRecord: number): number {
    const { sequence, itemsById, originLeftIndex, deleteTargets } = this.deps;
    const left = sequence.at(position);
    if (!left || offsetInRecord <= 0 || offsetInRecord >= left.content.length) {
      return position + (offsetInRecord > 0 ? 1 : 0);
    }

    const leftOriginalLength = left.content.length;
    const rightContent = left.content.slice(offsetInRecord);
    left.content = left.content.slice(0, offsetInRecord);
    sequence.updateItem(left);

    const right = this.buildSplitRightHalf(left, offsetInRecord, rightContent);
    sequence.insert(position + 1, right);
    itemsById.set(right.id, right);

    // Existing items with `originLeft = left.id` were anchored to the
    // right boundary of the pre-split record; that boundary now lives
    // at the end of {@link right}, so transfer their `originLeft`
    // references over. `originRight = left.id` references still point
    // at the left edge of the original record, which is unchanged.
    originLeftIndex.rewriteReferences(left.id, right.id, itemsById);
    // A typed-run right half is the causal continuation of the left half.
    // Track it only after rewriting old right-boundary references; tracking it
    // first would make the rewrite move its own originLeft to itself.
    originLeftIndex.track(right.id, right.originLeft);
    // Extend any prior delete-target memberships to cover {@link right}
    // as well. The pre-split record was already part of `deleteTargets`
    // for every event in this set; both halves now share the same
    // `everDeleted` and `prepareState` and must move together under
    // future retreat / advance calls for those events.
    deleteTargets.extendMembership(left.id, right.id);
    this.rewriteEventItemsForRunSplit(
      left,
      right,
      offsetInRecord,
      leftOriginalLength,
    );
    this.deps.onRecordSplit?.(left, right);
    return position + 1;
  }

  /**
   * Split a multi-character record so that the `length` code units starting
   * at `offsetInRecord` become an isolated record that the caller can mark
   * as deleted. Returns that middle record. Surrounding prefix/suffix halves
   * remain undeleted so future events can still reference the original
   * region. Used for placeholder, typed-run, and multi-character paste
   * records alike — the {@link splitRecordAt} dispatch picks the right
   * shape for each side.
   */
  splitRecordForDelete(
    position: number,
    offsetInRecord: number,
    length: number,
  ): AugmentedCRDTItem {
    if (offsetInRecord > 0) {
      const afterPrefix = this.splitRecordAt(position, offsetInRecord);
      position = afterPrefix;
    }
    const middle = this.deps.sequence.at(position);
    if (!middle) {
      throw new Error(`Record split missing record at position ${position}`);
    }
    if (length < middle.content.length) {
      this.splitRecordAt(position, length);
    }
    return middle;
  }

  /**
   * Ensure the slice owned by `eventId` is a single record before
   * retreat / advance toggle its `prepareState`. A typed-run leaf that
   * still holds more than this one event's code unit is carved into prefix /
   * slice / suffix records via {@link splitRecordAt}, which also remaps the
   * other events' `eventItems` entries to point at the new neighbours.
   * After the call, `eventItems.get(eventId)` references exactly the slice
   * to toggle.
   */
  isolateRunSliceForEvent(eventId: EventId): void {
    const { sequence, itemsById, eventItems } = this.deps;
    const items = eventItems.get(eventId);
    if (!items || items.length === 0) {
      // Event hasn't been integrated yet (e.g. a delete-only or pre-effect
      // retreat). Nothing to toggle.
      return;
    }
    if (items.length > 1) {
      // Multi-character INSERT events stay one record per code unit, each with
      // its own id and `run === null`. The retreat / advance loop already
      // toggles every slice in order; no isolation is needed.
      return;
    }
    const itemId = items[0];
    if (itemId === undefined) {
      return;
    }
    const record = itemsById.get(itemId);
    if (!record) {
      throw new Error(
        `eventItems pointed at unknown item ${itemId} for event ${eventId}`,
      );
    }
    if (record.run === null) {
      // Placeholder or per-code-unit paste record — nothing to coalesce, so
      // the slice is already this event's whole contribution.
      return;
    }
    const parsed = parseEventId(eventId);
    if (parsed === null || parsed.replicaId !== record.run.replicaId) {
      // A non-canonical event id ended up pointing at a typed-run record.
      // The run-extension guard in `applyInsert` only seeds runs from
      // canonical `replicaId:sequence` ids, so this should be unreachable;
      // bail out conservatively rather than splitting at a wrong offset.
      return;
    }
    const offsetInRecord = parsed.sequence - record.run.startSequence;
    if (offsetInRecord < 0 || offsetInRecord >= record.content.length) {
      // Same defensive bail-out: the eventItems entry should never point at
      // a record whose run no longer covers this event's sequence.
      return;
    }
    if (offsetInRecord === 0 && record.content.length === 1) {
      // Slice is already its own record.
      return;
    }

    let position = sequence.positionOf(record);
    if (position === -1) {
      throw new Error(`Record ${record.id} missing from sequence index`);
    }
    if (offsetInRecord > 0) {
      position = this.splitRecordAt(position, offsetInRecord);
    }
    const middle = sequence.at(position);
    if (middle && middle.content.length > 1) {
      this.splitRecordAt(position, 1);
    }
  }

  private buildSplitRightHalf(
    left: AugmentedCRDTItem,
    offsetInRecord: number,
    rightContent: string,
  ): AugmentedCRDTItem {
    if (left.run !== null) {
      const startSequence = left.run.startSequence + offsetInRecord;
      return {
        id: `${left.run.replicaId}:${startSequence}:0`,
        eventId: `${left.run.replicaId}:${startSequence}`,
        content: rightContent,
        // A typed run compresses a chain of per-event CRDT records. Splitting
        // must restore the chain boundary instead of erasing it, otherwise the
        // two halves can be integrated in different orders for the same DAG.
        // At record granularity `left.id` is the stable name of that boundary;
        // every event that lands there recomputes the same anchor after split.
        originLeft: left.id,
        originRight: left.originRight,
        everDeleted: left.everDeleted,
        prepareState: left.prepareState,
        run: {
          replicaId: left.run.replicaId,
          startSequence,
        },
      };
    }
    return {
      id: this.deps.nextPlaceholderId(),
      eventId: PLACEHOLDER_EVENT_ID,
      content: rightContent,
      originLeft: null,
      originRight: null,
      everDeleted: left.everDeleted,
      prepareState: left.prepareState,
      run: null,
    };
  }

  private rewriteEventItemsForRunSplit(
    left: AugmentedCRDTItem,
    right: AugmentedCRDTItem,
    offsetInRecord: number,
    leftOriginalLength: number,
  ): void {
    if (left.run === null) {
      return;
    }
    const { eventItems } = this.deps;
    eventItems.rewriteDirectReferencesForRunSplit(
      left,
      right,
      offsetInRecord,
      leftOriginalLength,
    );
    eventItems.registerRunItem(right);
  }
}
