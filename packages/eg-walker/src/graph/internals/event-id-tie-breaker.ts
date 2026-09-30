import type { EventId } from "../../types";
import { canonicalSequenceAfter } from "../event-id";

const UNPARSED = -2;
const NON_CANONICAL = -1;

/**
 * Orders events by ID exactly like {@link compareEventIds}, parsing each ID
 * at most once.
 *
 * Topological orders break ties between events that are ready together.
 * Comparing their IDs with {@link compareEventIds} split both IDs again at
 * every comparison. Here parsed keys live in columns indexed by insertion
 * rank: the canonical `replicaId:sequence` suffix as a number, and the prefix
 * as an index into a table of distinct prefixes. An ID is parsed only the
 * first time its event is compared, so the events of a long causal chain,
 * which are never ready together with another event, are never parsed.
 */
export class EventIdTieBreaker {
  private readonly prefixIndexes: Int32Array;
  private readonly sequences: Float64Array;
  private readonly prefixes: string[] = [];
  private readonly prefixIndexByPrefix = new Map<string, number>();

  constructor(
    count: number,
    private readonly idAt: (rank: number) => EventId,
  ) {
    this.prefixIndexes = new Int32Array(count).fill(UNPARSED);
    this.sequences = new Float64Array(count);
  }

  /** Compare the events at two ranks; same sign as {@link compareEventIds}. */
  compare(left: number, right: number): number {
    if (left === right) {
      return 0;
    }
    const leftPrefix = this.prefixIndexAt(left);
    const rightPrefix = this.prefixIndexAt(right);
    if (leftPrefix !== NON_CANONICAL && rightPrefix !== NON_CANONICAL) {
      if (leftPrefix !== rightPrefix) {
        return this.prefixes[leftPrefix]! < this.prefixes[rightPrefix]!
          ? -1
          : 1;
      }
      const leftSequence = this.sequences[left]!;
      const rightSequence = this.sequences[right]!;
      if (leftSequence === rightSequence) {
        return 0;
      }
      return leftSequence < rightSequence ? -1 : 1;
    }
    // Canonical IDs sort before custom IDs, which sort as raw strings.
    if (leftPrefix !== NON_CANONICAL) {
      return -1;
    }
    if (rightPrefix !== NON_CANONICAL) {
      return 1;
    }
    const leftId = this.idAt(left);
    const rightId = this.idAt(right);
    if (leftId === rightId) {
      return 0;
    }
    return leftId < rightId ? -1 : 1;
  }

  private prefixIndexAt(rank: number): number {
    const cached = this.prefixIndexes[rank]!;
    if (cached !== UNPARSED) {
      return cached;
    }
    const id = this.idAt(rank);
    const colonIndex = id.lastIndexOf(":");
    const sequence = canonicalSequenceAfter(id, colonIndex);
    let prefixIndex = NON_CANONICAL;
    if (sequence >= 0) {
      const prefix = id.slice(0, colonIndex);
      prefixIndex =
        this.prefixIndexByPrefix.get(prefix) ?? this.prefixes.length;
      if (prefixIndex === this.prefixes.length) {
        this.prefixes.push(prefix);
        this.prefixIndexByPrefix.set(prefix, prefixIndex);
      }
      this.sequences[rank] = sequence;
    }
    this.prefixIndexes[rank] = prefixIndex;
    return prefixIndex;
  }
}
