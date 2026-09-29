/**
 * Integration-ordered causal index over rich-text events.
 *
 * Each event receives a local version (LV) in integration order. Parents are
 * always integrated first, so LV order is a topological order of the event
 * DAG and an event can only be an ancestor of an event with a larger LV.
 *
 * Events are grouped into maximal chains in which every event's only parent is
 * the previous event of the same chain. A causally linear editing session is a
 * single chain, so ancestry inside it is an index comparison; searches across
 * chains visit chains rather than events and skip anything integrated before
 * the candidate ancestor.
 */

interface ChainNode {
  readonly parents: ReadonlyArray<string>;
  readonly ids: string[];
}

interface EventNode {
  readonly lv: number;
  readonly chain: ChainNode;
  readonly index: number;
}

export class CausalIndex {
  private readonly nodes = new Map<string, EventNode>();
  private readonly ancestry = new Map<string, Map<string, boolean>>();
  private readonly frontier = new Set<string>();
  private nextLv = 0;

  has(eventId: string): boolean {
    return this.nodes.has(eventId);
  }

  /** Whether `parents` names exactly the current causal frontier. */
  extendsFrontier(parents: ReadonlyArray<string>): boolean {
    return (
      parents.length === this.frontier.size &&
      parents.every((parent) => this.frontier.has(parent))
    );
  }

  /** Record one event whose parents are already integrated. */
  add(eventId: string, parents: ReadonlyArray<string>): void {
    if (this.nodes.has(eventId)) {
      throw new Error(`Event ${eventId} is already integrated`);
    }
    for (const parent of parents) {
      if (!this.nodes.has(parent)) {
        throw new Error(`Event ${eventId} names unknown parent ${parent}`);
      }
    }
    const parentNode =
      parents.length === 1 ? this.nodes.get(parents[0]!) : undefined;
    const chain =
      parentNode !== undefined &&
      parentNode.index === parentNode.chain.ids.length - 1
        ? parentNode.chain
        : { parents: [...parents], ids: [] };
    this.nodes.set(eventId, {
      lv: this.nextLv++,
      chain,
      index: chain.ids.length,
    });
    chain.ids.push(eventId);
    for (const parent of parents) {
      this.frontier.delete(parent);
    }
    this.frontier.add(eventId);
  }

  /** Integration order: every ancestor of an event comes before it. */
  order(eventId: string): number {
    const node = this.nodes.get(eventId);
    if (node === undefined) {
      throw new Error(`Event ${eventId} is not integrated`);
    }
    return node.lv;
  }

  /** Strict ancestry, matching a parent-graph search from `descendantId`. */
  isAncestor(ancestorId: string, descendantId: string): boolean {
    if (ancestorId === descendantId) {
      return false;
    }
    const ancestor = this.nodes.get(ancestorId);
    const descendant = this.nodes.get(descendantId);
    if (
      ancestor === undefined ||
      descendant === undefined ||
      ancestor.lv >= descendant.lv
    ) {
      return false;
    }
    if (ancestor.chain === descendant.chain) {
      return true;
    }
    const cached = this.ancestry.get(ancestorId)?.get(descendantId);
    if (cached !== undefined) {
      return cached;
    }
    const result = this.searchAncestor(ancestor, descendant);
    let byDescendant = this.ancestry.get(ancestorId);
    if (byDescendant === undefined) {
      byDescendant = new Map();
      this.ancestry.set(ancestorId, byDescendant);
    }
    byDescendant.set(descendantId, result);
    return result;
  }

  private searchAncestor(ancestor: EventNode, descendant: EventNode): boolean {
    const visited = new Set<ChainNode>([descendant.chain]);
    const stack = [...descendant.chain.parents];
    while (stack.length > 0) {
      const node = this.nodes.get(stack.pop()!)!;
      if (node.lv < ancestor.lv) {
        continue;
      }
      if (node.chain === ancestor.chain) {
        return true;
      }
      if (visited.has(node.chain)) {
        continue;
      }
      visited.add(node.chain);
      stack.push(...node.chain.parents);
    }
    return false;
  }
}
