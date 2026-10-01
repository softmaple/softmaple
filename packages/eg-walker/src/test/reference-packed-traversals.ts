/**
 * Per-event reference implementations of the packed graph traversals.
 *
 * `PackedEventGraphBase` orders events and plans critical sections over the
 * graph's runs. These are the per-event implementations it replaced, run over
 * CSR edges rebuilt from the graph's per-event accessors, kept as test
 * oracles for the span-based traversals.
 */

import { EventIdTieBreaker } from "../graph/internals/event-id-tie-breaker";
import { MaxHeap } from "../graph/internals/max-heap";
import type {
  PackedBranchReplayLayout,
  PackedEventGraphBase,
} from "../graph/internals/packed-event-graph-base";

const MAX_EXCLUSIVE_BRANCH_SPAN = 1_024;

interface PackedBranchTraversalWorkspace {
  readonly remainingParents: Uint32Array;
  readonly roots: number[];
  sortBranchGroup(group: number[]): void;
}

export class ReferencePackedTraversals {
  private readonly count: number;
  private readonly parentStarts: Uint32Array;
  private readonly parentOffsets: Uint32Array;
  private readonly childStarts: Uint32Array;
  private readonly childOffsets: Uint32Array;
  private readonly implicitLinearEdges = false;
  private readonly exactLinear: boolean;

  constructor(private readonly base: PackedEventGraphBase) {
    const count = base.count;
    this.count = count;
    this.parentStarts = new Uint32Array(count + 1);
    this.childStarts = new Uint32Array(count + 1);
    const parents: number[] = [];
    const children: number[] = [];
    for (let offset = 0; offset < count; offset++) {
      for (let index = 0; index < base.parentCountAt(offset); index++) {
        parents.push(base.parentOffsetAt(offset, index)!);
      }
      this.parentStarts[offset + 1] = parents.length;
      for (let index = 0; index < base.childCountAt(offset); index++) {
        children.push(base.childOffsetAt(offset, index)!);
      }
      this.childStarts[offset + 1] = children.length;
    }
    this.parentOffsets = Uint32Array.from(parents);
    this.childOffsets = Uint32Array.from(children);
    this.exactLinear = base.isExactLinear();
  }

  /**
   * Return Kahn's topological order as packed insertion offsets, taking
   * ready events in {@link compareEventIds} order.
   *
   * This is the order {@link EventGraph.getTopologicalOrder} returns. It runs
   * over the CSR edges with a typed parent counter and a heap of offsets, and
   * parses an event's ID only when it is ready together with another event.
   */
  getTopologicalOrderOffsets(): Uint32Array {
    const count = this.count;
    const order = new Uint32Array(count);
    if (this.implicitLinearEdges) {
      for (let offset = 0; offset < count; offset++) {
        order[offset] = offset;
      }
      return order;
    }
    const parentStarts = this.parentStarts;
    const childStarts = this.childStarts;
    const childOffsets = this.childOffsets;
    const ids = new EventIdTieBreaker(this.base);
    // A max-heap with an inverted comparator pops the smallest ready ID.
    const ready = new MaxHeap<number>((left, right) =>
      ids.compare(right, left),
    );
    const remainingParents = new Uint32Array(count);
    for (let offset = 0; offset < count; offset++) {
      const parentCount = parentStarts[offset + 1]! - parentStarts[offset]!;
      remainingParents[offset] = parentCount;
      if (parentCount === 0) {
        ready.push(offset);
      }
    }

    let length = 0;
    while (ready.size > 0) {
      const offset = ready.pop()!;
      order[length++] = offset;
      const end = childStarts[offset + 1]!;
      for (let cursor = childStarts[offset]!; cursor < end; cursor++) {
        const childOffset = childOffsets[cursor]!;
        const remaining = remainingParents[childOffset]! - 1;
        remainingParents[childOffset] = remaining;
        if (remaining === 0) {
          ready.push(childOffset);
        }
      }
    }
    if (length !== count) {
      throw new Error("Cycle detected in packed event graph");
    }
    return order;
  }

  /**
   * Return the branch-preserving traversal as packed insertion offsets.
   *
   * A decoded prefix is already a validated DAG whose parents always precede
   * their children. Keeping this traversal numeric avoids rebuilding an
   * `EventId -> remaining parent count` map and avoids a string-ID lookup plus
   * generator allocation for every visited child edge during cold replay.
   */
  getBranchPreservingOrderOffsets(): Uint32Array {
    if (this.implicitLinearEdges) {
      const result = new Uint32Array(this.count);
      for (let offset = 0; offset < this.count; offset++) {
        result[offset] = offset;
      }
      return result;
    }
    const { remainingParents, roots, sortBranchGroup } =
      this.createBranchTraversalWorkspace();

    const stack: number[] = [];
    for (let index = roots.length - 1; index >= 0; index--) {
      stack.push(roots[index]!);
    }

    const result = new Uint32Array(this.count);
    let resultLength = 0;
    // Most events release no child (and a linear edge releases exactly one).
    // Reusing one scratch group avoids allocating an empty array for every
    // event in large operation-granularity traces while preserving the same
    // branch-group ordering whenever several children become ready together.
    const newlyReady: number[] = [];
    while (stack.length > 0) {
      const offset = stack.pop()!;
      result[resultLength++] = offset;

      newlyReady.length = 0;
      const start = this.childStarts[offset]!;
      const end = this.childStarts[offset + 1]!;
      for (let cursor = start; cursor < end; cursor++) {
        const childOffset = this.childOffsets[cursor]!;
        const remaining = remainingParents[childOffset]! - 1;
        remainingParents[childOffset] = remaining;
        if (remaining === 0) newlyReady.push(childOffset);
      }
      if (newlyReady.length > 1) {
        sortBranchGroup(newlyReady);
      }
      for (let index = newlyReady.length - 1; index >= 0; index--) {
        stack.push(newlyReady[index]!);
      }
    }

    if (resultLength !== this.count) {
      throw new Error("Cycle detected in packed event graph");
    }
    return result;
  }

  /**
   * Build replay order, inverse rank, and critical cuts in one numeric DFS.
   *
   * The standalone critical planner historically initialized another parent
   * counter, walked every child edge again, kept a separate ready bitmap, and
   * inverted the finished order in a final pass. The DFS stack is already the
   * authoritative ready set, so critical-frontier accounting can advance as
   * each offset is emitted. Once an offset is popped, its remaining-parent
   * slot is dead and can hold the inverse replay rank.
   */
  buildBranchPreservingCriticalReplayLayout(): PackedBranchReplayLayout {
    const eventCount = this.count;
    if (eventCount === 0) {
      const empty = new Uint32Array();
      return {
        eventOrder: empty,
        rankByOffset: empty,
        sectionEnds: empty,
        linearSections: new Uint8Array(),
        sectionCount: 0,
        runCount: 0,
      };
    }

    if (this.exactLinear) {
      const eventOrder = new Uint32Array(eventCount);
      for (let offset = 0; offset < eventCount; offset++) {
        eventOrder[offset] = offset;
      }
      return {
        eventOrder,
        rankByOffset: eventOrder,
        sectionEnds: new Uint32Array([eventCount]),
        linearSections: new Uint8Array([1]),
        sectionCount: 1,
        runCount: 0,
      };
    }

    const { remainingParents, roots, sortBranchGroup } =
      this.createBranchTraversalWorkspace();
    const parentStarts = this.parentStarts;
    const parentOffsets = this.parentOffsets;
    const childStarts = this.childStarts;
    const childOffsets = this.childOffsets;

    const stack: number[] = [];
    for (let index = roots.length - 1; index >= 0; index--) {
      stack.push(roots[index]!);
    }

    const eventOrder = new Uint32Array(eventCount);
    const rankByOffset = remainingParents;
    const sectionEnds = new Uint32Array(eventCount);
    const linearSections = new Uint8Array(eventCount);
    const prefixFrontier = new Uint8Array(eventCount);
    const readyParentCoverage = new Uint32Array(eventCount);
    const newlyReady: number[] = [];

    let readyCount = roots.length;
    let prefixFrontierSize = 0;
    let missingReadyParentPairs = 0;
    let sectionCount = 0;
    let sectionStart = 0;
    let sectionIsLinear = true;
    let resultLength = 0;

    while (stack.length > 0) {
      const eventOffset = stack.pop()!;
      const orderIndex = resultLength;
      eventOrder[orderIndex] = eventOffset;
      rankByOffset[eventOffset] = orderIndex;
      resultLength++;
      readyCount--;

      const parentStart = parentStarts[eventOffset]!;
      const parentEnd = parentStarts[eventOffset + 1]!;
      const parentCount = parentEnd - parentStart;
      const prefixFrontierSizeBefore = prefixFrontierSize;
      let parentsInPrefixFrontier = 0;

      // Remove the popped ready root's coverage while replacing its live
      // parents with the event itself. All arithmetic uses the ready count
      // after the pop, matching the standalone planner exactly.
      for (let cursor = parentStart; cursor < parentEnd; cursor++) {
        const parentOffset = parentOffsets[cursor]!;
        const previousCoverage = readyParentCoverage[parentOffset]!;
        if (previousCoverage === 0) {
          throw new Error("Invalid packed replay ready-parent coverage");
        }
        const nextCoverage = previousCoverage - 1;
        readyParentCoverage[parentOffset] = nextCoverage;

        if (prefixFrontier[parentOffset] !== 1) {
          continue;
        }
        parentsInPrefixFrontier++;
        missingReadyParentPairs -= readyCount - nextCoverage;
        prefixFrontier[parentOffset] = 0;
        prefixFrontierSize--;
      }

      if (orderIndex === sectionStart) {
        sectionIsLinear =
          parentCount === prefixFrontierSizeBefore &&
          parentsInPrefixFrontier === prefixFrontierSizeBefore;
      } else if (
        parentCount !== 1 ||
        parentOffsets[parentStart] !== eventOrder[orderIndex - 1]
      ) {
        sectionIsLinear = false;
      }

      missingReadyParentPairs -=
        prefixFrontierSizeBefore - parentsInPrefixFrontier;
      prefixFrontier[eventOffset] = 1;
      prefixFrontierSize++;
      missingReadyParentPairs += readyCount - readyParentCoverage[eventOffset]!;

      newlyReady.length = 0;
      const childStart = childStarts[eventOffset]!;
      const childEnd = childStarts[eventOffset + 1]!;
      for (let cursor = childStart; cursor < childEnd; cursor++) {
        const childOffset = childOffsets[cursor]!;
        const remaining = remainingParents[childOffset]! - 1;
        remainingParents[childOffset] = remaining;
        if (remaining !== 0) {
          continue;
        }

        const childParentStart = parentStarts[childOffset]!;
        const childParentEnd = parentStarts[childOffset + 1]!;
        let childParentsInPrefixFrontier = 0;
        for (
          let parentCursor = childParentStart;
          parentCursor < childParentEnd;
          parentCursor++
        ) {
          const parentOffset = parentOffsets[parentCursor]!;
          if (prefixFrontier[parentOffset] === 1) {
            childParentsInPrefixFrontier++;
          }
          readyParentCoverage[parentOffset] =
            readyParentCoverage[parentOffset]! + 1;
        }
        missingReadyParentPairs +=
          prefixFrontierSize - childParentsInPrefixFrontier;
        readyCount++;
        newlyReady.push(childOffset);
      }

      if (readyCount === 0 || missingReadyParentPairs === 0) {
        sectionEnds[sectionCount] = orderIndex + 1;
        linearSections[sectionCount] = sectionIsLinear ? 1 : 0;
        sectionCount++;
        sectionStart = orderIndex + 1;
      }

      // A strict p -> v -> c chain leaves every frontier cardinality and
      // ready-parent coverage total unchanged while replacing p with v.
      // Hold the sole newly-ready event out of the stack, emit v, and replace
      // it with c without repeating the parent/child edge scans.
      // Stop before a leaf, fan-out, or fan-in boundary; the normal loop owns
      // those state transitions.
      if (
        newlyReady.length === 1 &&
        childEnd - childStart === 1 &&
        childOffsets[childStart] === newlyReady[0] &&
        prefixFrontier[eventOffset] === 1 &&
        readyParentCoverage[eventOffset] === 1
      ) {
        let chainEventOffset = newlyReady[0]!;
        const chainEventParentStart = parentStarts[chainEventOffset]!;
        const chainEventParentEnd = parentStarts[chainEventOffset + 1]!;
        if (
          chainEventParentEnd - chainEventParentStart === 1 &&
          parentOffsets[chainEventParentStart] === eventOffset &&
          remainingParents[chainEventOffset] === 0
        ) {
          let chainTailOffset = -1;
          const chainEmitsCut =
            readyCount === 0 || missingReadyParentPairs === 0;
          const chainSectionIsLinear = prefixFrontierSize === 1;
          if (!chainEmitsCut && resultLength === sectionStart) {
            sectionIsLinear = chainSectionIsLinear;
          }

          // Packed insertion offsets are topological ranks. Long operation-
          // granularity runs are normally stored as consecutive one-parent
          // offsets, so prove that compact CSR shape directly and skip child
          // offset loads plus parent-counter writes for every interior event.
          while (chainEventOffset + 1 < eventCount) {
            const chainChildOffset = chainEventOffset + 1;
            const chainChildStart = childStarts[chainEventOffset]!;
            const chainChildParentStart = parentStarts[chainChildOffset]!;
            if (
              childStarts[chainEventOffset + 1] !== chainChildStart + 1 ||
              parentStarts[chainChildOffset + 1] !==
                chainChildParentStart + 1 ||
              parentOffsets[chainChildParentStart] !== chainEventOffset
            ) {
              break;
            }

            eventOrder[resultLength] = chainEventOffset;
            rankByOffset[chainEventOffset] = resultLength;
            resultLength++;
            if (chainEmitsCut) {
              sectionEnds[sectionCount] = resultLength;
              linearSections[sectionCount] = chainSectionIsLinear ? 1 : 0;
              sectionCount++;
              sectionStart = resultLength;
            }

            chainTailOffset = chainEventOffset;
            chainEventOffset = chainChildOffset;
          }

          // The general tier preserves arbitrary non-adjacent packed DAGs.
          // Interior remaining-parent slots are dead once their event is
          // emitted and immediately become inverse ranks, so only the final
          // held-out child needs to be marked ready before it reaches stack.
          while (true) {
            const chainChildStart = childStarts[chainEventOffset]!;
            const chainChildEnd = childStarts[chainEventOffset + 1]!;
            if (chainChildEnd - chainChildStart !== 1) {
              break;
            }
            const chainChildOffset = childOffsets[chainChildStart]!;
            const chainChildParentStart = parentStarts[chainChildOffset]!;
            const chainChildParentEnd = parentStarts[chainChildOffset + 1]!;
            if (
              chainChildParentEnd - chainChildParentStart !== 1 ||
              parentOffsets[chainChildParentStart] !== chainEventOffset ||
              remainingParents[chainChildOffset] !== 1
            ) {
              break;
            }

            eventOrder[resultLength] = chainEventOffset;
            rankByOffset[chainEventOffset] = resultLength;
            resultLength++;
            if (chainEmitsCut) {
              sectionEnds[sectionCount] = resultLength;
              linearSections[sectionCount] = chainSectionIsLinear ? 1 : 0;
              sectionCount++;
              sectionStart = resultLength;
            }

            chainTailOffset = chainEventOffset;
            chainEventOffset = chainChildOffset;
          }

          if (chainTailOffset !== -1) {
            remainingParents[chainEventOffset] = 0;
            prefixFrontier[eventOffset] = 0;
            readyParentCoverage[eventOffset] = 0;
            prefixFrontier[chainTailOffset] = 1;
            readyParentCoverage[chainTailOffset] = 1;
            newlyReady[0] = chainEventOffset;
          }
        }
      }

      if (newlyReady.length > 1) {
        sortBranchGroup(newlyReady);
      }
      for (let index = newlyReady.length - 1; index >= 0; index--) {
        stack.push(newlyReady[index]!);
      }
    }

    if (resultLength !== eventCount) {
      throw new Error("Cycle detected in packed event graph");
    }
    if (sectionStart !== eventCount) {
      throw new Error("Packed critical replay plan did not cover every event");
    }

    return {
      eventOrder,
      rankByOffset,
      sectionEnds: sectionEnds.slice(0, sectionCount),
      linearSections: linearSections.slice(0, sectionCount),
      sectionCount,
      runCount: 0,
    };
  }

  private createBranchTraversalWorkspace(): PackedBranchTraversalWorkspace {
    const remainingParents = new Uint32Array(this.count);
    const exclusiveSpan = new Uint32Array(this.count);
    let longestPath: Uint32Array | null = null;
    const roots: number[] = [];
    const parentStarts = this.parentStarts;
    const childStarts = this.childStarts;
    const childOffsets = this.childOffsets;

    for (let offset = 0; offset < this.count; offset++) {
      const parentCount = parentStarts[offset + 1]! - parentStarts[offset]!;
      remainingParents[offset] = parentCount;
      if (parentCount === 0) {
        roots.push(offset);
      }
    }

    // Packed insertion offsets are topological ranks. Accumulate the size of
    // each exclusive single-parent branch in reverse order; multi-parent
    // merge suffixes are shared and therefore do not belong to either branch.
    //
    // Longest-path ordering is needed only after some exclusive branch crosses
    // MAX_EXCLUSIVE_BRANCH_SPAN. Most collaborative traces never cross that
    // threshold, so allocating and filling another event-sized column for
    // every child edge is pure cold-load overhead. Activate it lazily at the
    // first long branch. Because children have larger topological offsets,
    // only the already-visited suffix needs a one-time backfill.
    let nextCombinedOffset = -1;
    for (let offset = this.count - 1; offset >= 0; offset--) {
      let span = 1;
      const start = childStarts[offset]!;
      const end = childStarts[offset + 1]!;
      for (let cursor = start; cursor < end; cursor++) {
        const childOffset = childOffsets[cursor]!;
        if (remainingParents[childOffset] === 1) {
          span += exclusiveSpan[childOffset]!;
        }
      }
      exclusiveSpan[offset] = span;
      if (span > MAX_EXCLUSIVE_BRANCH_SPAN) {
        longestPath = new Uint32Array(this.count);
        for (
          let backfillOffset = this.count - 1;
          backfillOffset >= offset;
          backfillOffset--
        ) {
          let backfillPath = 1;
          const backfillStart = childStarts[backfillOffset]!;
          const backfillEnd = childStarts[backfillOffset + 1]!;
          for (let cursor = backfillStart; cursor < backfillEnd; cursor++) {
            backfillPath = Math.max(
              backfillPath,
              1 + longestPath[childOffsets[cursor]!]!,
            );
          }
          longestPath[backfillOffset] = backfillPath;
        }
        nextCombinedOffset = offset - 1;
        break;
      }
    }
    if (longestPath !== null) {
      for (let offset = nextCombinedOffset; offset >= 0; offset--) {
        let span = 1;
        let path = 1;
        const start = childStarts[offset]!;
        const end = childStarts[offset + 1]!;
        for (let cursor = start; cursor < end; cursor++) {
          const childOffset = childOffsets[cursor]!;
          if (remainingParents[childOffset] === 1) {
            span += exclusiveSpan[childOffset]!;
          }
          path = Math.max(path, 1 + longestPath[childOffset]!);
        }
        exclusiveSpan[offset] = span;
        longestPath[offset] = path;
      }
    }

    // Most sibling groups differ in span; IDs break only the remaining ties.
    const ids = new EventIdTieBreaker(this.base);
    const compareIds = (left: number, right: number): number =>
      ids.compare(left, right);
    const compareExclusive = (left: number, right: number): number => {
      const difference = exclusiveSpan[left]! - exclusiveSpan[right]!;
      return difference === 0 ? compareIds(left, right) : difference;
    };
    const compareLongest = (left: number, right: number): number => {
      const difference = longestPath![left]! - longestPath![right]!;
      return difference === 0 ? compareIds(left, right) : difference;
    };
    const sortBranchGroup = (group: number[]): void => {
      let hasLongExclusiveBranch = false;
      for (let index = 0; index < group.length; index++) {
        if (exclusiveSpan[group[index]!]! > MAX_EXCLUSIVE_BRANCH_SPAN) {
          hasLongExclusiveBranch = true;
          break;
        }
      }
      group.sort(hasLongExclusiveBranch ? compareLongest : compareExclusive);
    };
    if (roots.length > 1) {
      sortBranchGroup(roots);
    }

    return { remainingParents, roots, sortBranchGroup };
  }
}
