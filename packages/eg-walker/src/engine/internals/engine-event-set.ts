/**
 * Local versions of the events a replay engine has integrated, in the order
 * it integrated them.
 *
 * Membership is asked once or more for every event of every retreat and
 * advance. The events of a retained engine are the events after a critical
 * cut, which are one contiguous run of insertion ranks, and a receive appends
 * the next ones, so membership is a range check. A set of local versions is
 * built only for an engine whose events are not contiguous.
 */
export class EngineEventSet {
  /** The events in the order they were added. */
  readonly order: number[] = [];
  private min = Number.POSITIVE_INFINITY;
  private max = -1;
  private members: Set<number> | null = null;

  get size(): number {
    return this.order.length;
  }

  clear(): void {
    this.order.length = 0;
    this.min = Number.POSITIVE_INFINITY;
    this.max = -1;
    this.members = null;
  }

  /** Add an event the set does not hold yet. */
  push(localVersion: number): void {
    this.order.push(localVersion);
    if (localVersion < this.min) {
      this.min = localVersion;
    }
    if (localVersion > this.max) {
      this.max = localVersion;
    }
    this.members?.add(localVersion);
  }

  has(localVersion: number): boolean {
    if (this.order.length === this.max - this.min + 1) {
      return localVersion >= this.min && localVersion <= this.max;
    }
    this.members ??= new Set(this.order);
    return this.members.has(localVersion);
  }
}
