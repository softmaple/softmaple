import type { IndexedSequence } from "../indexed-sequence";
import { DeleteTargetIndex } from "./delete-target-index";
import {
  PLACEHOLDER_AGENT,
  placeholderSerialOf,
  type AugmentedCRDTItem,
  type ItemKey,
  type ItemTable,
} from "./engine-types";
import {
  EventItemIndex,
  type EventIdentityResolver,
  type EventItems,
} from "./event-item-index";
import { OriginLeftIndex } from "./origin-left-index";
import type { RecordContent } from "./record-content";
import { shiftExternalItemIds } from "./sequence-records";

interface RecordSplitterDeps {
  readonly sequence: IndexedSequence<AugmentedCRDTItem>;
  readonly items: ItemTable;
  readonly events: EventIdentityResolver;
  readonly eventItems: EventItemIndex;
  readonly originLeftIndex: OriginLeftIndex;
  readonly deleteTargets: DeleteTargetIndex;
  readonly nextPlaceholderSerial: () => number;
  readonly onRecordSplit?: (
    left: AugmentedCRDTItem,
    right: AugmentedCRDTItem,
  ) => void;
}

/**
 * On-demand split of run-length records (placeholders, typed-run leaves and
 * insert runs) when concurrent inserts or deletes anchor inside them.
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
   * Three record shapes carry multi-character content and can be split:
   *
   * - **Placeholder:** right gets a fresh placeholder serial; both halves
   *   stay anonymous placeholder records.
   * - **Typed-run record:** right continues the run's agent with its start
   *   sequence advanced by `offsetInRecord` and is registered as one numeric
   *   range, so retreat / advance resolve either half logarithmically.
   * - **Insert-run record:** right keeps the insert event and starts at the
   *   code-unit offset advanced by `offsetInRecord`; it joins the event's
   *   item entry, so retreat / advance toggle every fragment.
   */
  splitRecordAt(position: number, offsetInRecord: number): number {
    const { sequence } = this.deps;
    const left = sequence.at(position);
    if (!left || offsetInRecord <= 0 || offsetInRecord >= left.content.length) {
      return position + (offsetInRecord > 0 ? 1 : 0);
    }

    this.splitRecord(left, offsetInRecord);
    return position + 1;
  }

  private splitRecord(
    left: AugmentedCRDTItem,
    offsetInRecord: number,
  ): AugmentedCRDTItem {
    const { sequence, items, originLeftIndex, deleteTargets } = this.deps;
    if (offsetInRecord <= 0 || offsetInRecord >= left.content.length) {
      throw new Error(
        `Record split offset ${offsetInRecord} is invalid for ${left.id}`,
      );
    }

    const leftOriginalContent = left.content;
    const rightContent = left.content.slice(offsetInRecord);
    left.content = left.content.slice(0, offsetInRecord);

    const right = this.buildSplitRightHalf(left, offsetInRecord, rightContent);
    if (!sequence.updateAndInsertAfter(left, right)) {
      // The sequence still carries the old cached weights because the fused
      // mutation did not run. Restore the object too before surfacing the
      // violated internal invariant.
      left.content = leftOriginalContent;
      throw new Error(`Record ${left.id} missing from sequence index`);
    }
    items.add(right);

    // Existing items with `originLeft = left.id` were anchored to the
    // right boundary of the pre-split record; that boundary now lives
    // at the end of {@link right}, so transfer their `originLeft`
    // references over. `originRight = left.id` references still point
    // at the left edge of the original record, which is unchanged.
    originLeftIndex.rewriteReferences(left.id, right.id, (itemId) =>
      items.at(itemId),
    );
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
    if (left.run) {
      this.deps.eventItems.registerRunItem(right);
    } else if (left.agent !== PLACEHOLDER_AGENT) {
      this.deps.eventItems.addSplitFragment(left.id, right.id);
    }
    this.deps.onRecordSplit?.(left, right);
    return right;
  }

  /**
   * Split a multi-character record so that the `length` code units starting
   * at `offsetInRecord` become an isolated record that the caller can mark
   * as deleted. Returns that middle record. Surrounding prefix/suffix halves
   * remain undeleted so future events can still reference the original
   * region. Used for placeholder, typed-run, and insert-run records alike —
   * {@link buildSplitRightHalf} picks the right shape for each side.
   */
  splitRecordForDelete(
    candidate: AugmentedCRDTItem,
    offsetInRecord: number,
    length: number,
  ): AugmentedCRDTItem {
    let middle = candidate;
    if (offsetInRecord > 0) {
      middle = this.splitRecord(candidate, offsetInRecord);
    }
    if (length < middle.content.length) {
      this.splitRecord(middle, length);
    }
    return middle;
  }

  /**
   * Ensure the slice owned by the event at `localVersion` is a single record
   * before retreat / advance toggle its `prepareState`. A typed-run leaf that
   * still holds more than this one event's code unit is carved into prefix /
   * slice / suffix records via {@link splitRecordAt}, which also remaps the
   * other events' item entries to point at the new neighbours.
   * Returns the exact scalar/array references that the caller should toggle;
   * this avoids a second event-index lookup after split bookkeeping.
   */
  isolateRunSliceForEvent(localVersion: number): EventItems | undefined {
    const { items, eventItems, events } = this.deps;
    const eventItemIds = eventItems.get(localVersion);
    if (
      eventItemIds === undefined ||
      (typeof eventItemIds !== "number" && eventItemIds.length === 0)
    ) {
      // Event hasn't been integrated yet (e.g. a delete-only or pre-effect
      // retreat). Nothing to toggle.
      return eventItemIds;
    }
    if (typeof eventItemIds !== "number" && eventItemIds.length > 1) {
      // The fragments of a split insert-run record (or the per-code-unit
      // records of a restored insert) each hold only this event's code
      // units. The retreat / advance loop toggles every one; no isolation is
      // needed.
      return eventItemIds;
    }
    const itemId =
      typeof eventItemIds === "number" ? eventItemIds : eventItemIds[0];
    if (itemId === undefined) {
      return eventItemIds;
    }
    const record = items.at(itemId);
    if (!record) {
      throw new Error(
        `eventItems pointed at unknown item ${itemId} for event ${localVersion}`,
      );
    }
    if (!record.run || record.content.length === 1) {
      // Insert-run record, which holds only this event's code units, or a
      // one-code-unit run that is already the exact slice.
      return eventItemIds;
    }
    if (events.agentAt(localVersion) !== record.agent) {
      // A non-canonical event ended up pointing at a typed-run record. The
      // run-extension guard in `applyInsert` only seeds runs from canonical
      // events, so this should be unreachable; bail out conservatively
      // rather than splitting at a wrong offset.
      return eventItemIds;
    }
    const middle = this.isolateScalar(record, events.sequenceAt(localVersion));
    return middle === null ? eventItemIds : middle.id;
  }

  /**
   * Isolate the code unit of the canonical scalar event `(agent, sequence)`
   * inside its typed-run record, or return `null` when no run holds it.
   */
  isolateRunSliceForCanonical(
    agent: number,
    sequence: number,
  ): AugmentedCRDTItem | null {
    const record = this.deps.eventItems.getRunItem(agent, sequence);
    if (record === undefined || !record.run) {
      return null;
    }
    if (record.content.length === 1) {
      return record;
    }
    return this.isolateScalar(record, sequence);
  }

  private isolateScalar(
    record: AugmentedCRDTItem,
    sequence: number,
  ): AugmentedCRDTItem | null {
    const offsetInRecord = sequence - record.sequence;
    if (offsetInRecord < 0 || offsetInRecord >= record.content.length) {
      // The item entry should never point at a record whose run no longer
      // covers this event's sequence.
      return null;
    }
    if (offsetInRecord === 0 && record.content.length === 1) {
      return record;
    }

    let middle = record;
    if (offsetInRecord > 0) {
      middle = this.splitRecord(record, offsetInRecord);
    }
    if (middle.content.length > 1) {
      this.splitRecord(middle, 1);
    }
    return middle;
  }

  /**
   * Isolate as much as possible of a contiguous canonical scalar-event span
   * inside its current typed-run record. At most the two outer boundaries are
   * split; callers repeat at the next sequence when an existing record
   * boundary falls inside the requested interval.
   *
   * Resolving through {@link EventItemIndex.get} preserves direct-event map
   * precedence. `null` therefore means the caller must retain the exact
   * scalar compatibility path for this event.
   */
  isolateRunSpanForEvents(
    firstLocalVersion: number,
    maximumEventCount: number,
  ): AugmentedCRDTItem | null {
    const { items, eventItems, events } = this.deps;
    const agent = events.agentAt(firstLocalVersion);
    if (
      agent < 0 ||
      !Number.isSafeInteger(maximumEventCount) ||
      maximumEventCount <= 0
    ) {
      return null;
    }

    const itemId = eventItems.get(firstLocalVersion);
    if (typeof itemId !== "number") {
      return null;
    }
    const record = items.at(itemId);
    if (
      record === undefined ||
      !record.run ||
      typeof record.content !== "string" ||
      record.agent !== agent
    ) {
      return null;
    }

    return this.isolateCanonicalRunSpan(
      record,
      events.sequenceAt(firstLocalVersion),
      maximumEventCount,
    );
  }

  /** Packed equivalent that consumes already-decoded canonical ID columns. */
  isolateRunSpanForCanonicalEvents(
    agent: number,
    firstSequence: number,
    maximumEventCount: number,
  ): AugmentedCRDTItem | null {
    if (
      !Number.isSafeInteger(firstSequence) ||
      firstSequence < 0 ||
      !Number.isSafeInteger(maximumEventCount) ||
      maximumEventCount <= 0
    ) {
      return null;
    }
    const record = this.deps.eventItems.getRunItem(agent, firstSequence);
    if (
      record === undefined ||
      !record.run ||
      typeof record.content !== "string" ||
      record.agent !== agent
    ) {
      return null;
    }
    return this.isolateCanonicalRunSpan(
      record,
      firstSequence,
      maximumEventCount,
    );
  }

  private isolateCanonicalRunSpan(
    record: AugmentedCRDTItem,
    firstSequence: number,
    maximumEventCount: number,
  ): AugmentedCRDTItem | null {
    if (!record.run || typeof record.content !== "string") {
      return null;
    }
    const offsetInRecord = firstSequence - record.sequence;
    if (offsetInRecord < 0 || offsetInRecord >= record.content.length) {
      return null;
    }
    const availableEvents = record.content.length - offsetInRecord;
    const isolatedEventCount = Math.min(maximumEventCount, availableEvents);
    if (isolatedEventCount <= 0) {
      return null;
    }

    let middle = record;
    if (offsetInRecord > 0) {
      middle = this.splitRecord(record, offsetInRecord);
    }
    if (isolatedEventCount < middle.content.length) {
      this.splitRecord(middle, isolatedEventCount);
    }
    return middle;
  }

  private buildSplitRightHalf(
    left: AugmentedCRDTItem,
    offsetInRecord: number,
    rightContent: RecordContent,
  ): AugmentedCRDTItem {
    const id: ItemKey = this.deps.items.nextKey();
    if (left.run) {
      if (typeof rightContent !== "string") {
        throw new Error("Typed-run split content must be materialized text");
      }
      return {
        id,
        agent: left.agent,
        sequence: left.sequence + offsetInRecord,
        offset: 0,
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
        run: true,
      };
    }

    if (left.agent !== PLACEHOLDER_AGENT) {
      // Insert run: the right half's first code unit followed the left
      // half's last one in its event, so the left half is its chain
      // boundary, exactly as for a typed-run split.
      const right: AugmentedCRDTItem = {
        id,
        agent: left.agent,
        sequence: left.sequence,
        offset: left.offset + offsetInRecord,
        content: rightContent,
        originLeft: left.id,
        originRight: left.originRight,
        everDeleted: left.everDeleted,
        prepareState: left.prepareState,
        run: false,
      };
      return left.external === undefined
        ? right
        : {
            ...right,
            external: shiftExternalItemIds(left.external, offsetInRecord),
          };
    }

    const leftPlaceholder = left.placeholder;
    if (leftPlaceholder !== undefined) {
      const rightPlaceholder = leftPlaceholder.state.splitPhysicalSlice(
        leftPlaceholder,
        offsetInRecord,
      );
      const segmentId = leftPlaceholder.state.segmentIdAtBoundary(
        rightPlaceholder.start,
      );
      const serial = placeholderSerialOf(segmentId);
      if (serial < 0) {
        throw new Error(`Invalid placeholder segment ID ${segmentId}`);
      }
      const right: AugmentedCRDTItem = {
        id,
        agent: PLACEHOLDER_AGENT,
        sequence: serial,
        offset: 0,
        content: rightContent,
        originLeft: null,
        originRight: null,
        everDeleted: false,
        prepareState: 1,
        run: false,
        placeholder: rightPlaceholder,
      };
      rightPlaceholder.attachOwner(right);
      return right;
    }

    return {
      id,
      agent: PLACEHOLDER_AGENT,
      sequence: this.deps.nextPlaceholderSerial(),
      offset: 0,
      content: rightContent,
      originLeft: null,
      originRight: null,
      everDeleted: left.everDeleted,
      prepareState: left.prepareState,
      run: false,
    };
  }
}
