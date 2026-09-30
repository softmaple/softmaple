/**
 * Replica IDs of canonical `replicaId:sequence` event IDs, numbered densely in
 * the order they are first seen.
 *
 * An event graph and every ID index it reads share one table, so an agent
 * number names the same replica in the packed prefix, the mutable tail and a
 * replay engine working on the graph. Numbers are never reused or removed:
 * rolling back events that introduced an agent leaves its number assigned.
 */
export class AgentTable {
  private readonly names: string[] = [];
  private readonly numbers = new Map<string, number>();
  /** The two agents most recently resolved from an ID prefix. */
  private recent = -1;
  private previous = -1;

  get size(): number {
    return this.names.length;
  }

  /** Number of `name`, or `-1` when the table has not seen it. */
  numberOf(name: string): number {
    return this.numbers.get(name) ?? -1;
  }

  /** Number of `name`, assigning the next number the first time. */
  intern(name: string): number {
    const existing = this.numbers.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const agent = this.names.length;
    this.names.push(name);
    this.numbers.set(name, agent);
    return agent;
  }

  nameOf(agent: number): string {
    const name = this.names[agent];
    if (name === undefined) {
      throw new Error(`Unknown agent ${agent}`);
    }
    return name;
  }

  /**
   * Whether `id` is `${nameOf(agent)}:…` with its last colon at `colonIndex`.
   * Compares in place, so a lookup does not slice the prefix.
   */
  isPrefixOf(agent: number, id: string, colonIndex: number): boolean {
    const name = this.names[agent];
    return (
      name !== undefined && name.length === colonIndex && id.startsWith(name)
    );
  }

  /**
   * Agent named by the part of `id` before `colonIndex`, or `-1`.
   *
   * Lookups tend to alternate between a few replicas, so the two agents
   * resolved last are compared in place before slicing the prefix.
   */
  resolvePrefix(id: string, colonIndex: number): number {
    const recent = this.recent;
    if (recent >= 0 && this.isPrefixOf(recent, id, colonIndex)) {
      return recent;
    }
    const previous = this.previous;
    if (previous >= 0 && this.isPrefixOf(previous, id, colonIndex)) {
      this.previous = recent;
      this.recent = previous;
      return previous;
    }
    const agent = this.numbers.get(id.slice(0, colonIndex)) ?? -1;
    if (agent >= 0) {
      this.remember(agent);
    }
    return agent;
  }

  /** Like {@link resolvePrefix}, assigning a number to a new replica. */
  internPrefix(id: string, colonIndex: number): number {
    const known = this.resolvePrefix(id, colonIndex);
    if (known >= 0) {
      return known;
    }
    const agent = this.intern(id.slice(0, colonIndex));
    this.remember(agent);
    return agent;
  }

  private remember(agent: number): void {
    if (agent !== this.recent) {
      this.previous = this.recent;
      this.recent = agent;
    }
  }

  /**
   * Order two agents by replica ID, as {@link compareEventIds} orders the
   * prefixes of two canonical IDs.
   */
  compare(left: number, right: number): number {
    if (left === right) {
      return 0;
    }
    return this.nameOf(left) < this.nameOf(right) ? -1 : 1;
  }
}
