import type { AugmentedCRDTItem } from "./engine-types";

/**
 * Prepare-state deltas of one retreat/advance transition, by item.
 *
 * A transition adds one delta for every insert span and delete target it
 * toggles, and a long transition toggles tens of thousands. Item keys are
 * dense, so deltas live in typed columns indexed by key, and an epoch stamp
 * says which entries belong to the current transition: clearing is a counter
 * increment instead of a pass over the entries. Entries keep the semantics of
 * a `Map<item, delta>`: deltas that cancel out remove the entry, and
 * {@link touch} adds an entry with no delta.
 */
export class PrepareDeltaBuffer {
  private values = new Int32Array(64);
  /** `epoch` while the key has an entry. */
  private present = new Uint32Array(64);
  /** `epoch` once the key's item is in {@link items}. */
  private listed = new Uint32Array(64);
  private epoch = 1;
  private readonly items: AugmentedCRDTItem[] = [];
  private entryCount = 0;

  get size(): number {
    return this.entryCount;
  }

  /** Add `delta` to the item's entry; an entry whose deltas cancel is removed. */
  add(item: AugmentedCRDTItem, delta: number): void {
    const key = item.id;
    this.ensureKey(key);
    if (this.present[key] === this.epoch) {
      const next = this.values[key]! + delta;
      if (next === 0) {
        this.present[key] = 0;
        this.entryCount--;
      } else {
        this.values[key] = next;
      }
      return;
    }
    if (delta === 0) {
      return;
    }
    this.insert(item, key, delta);
  }

  /** Give the item an entry, with no delta, unless it has one. */
  touch(item: AugmentedCRDTItem): void {
    const key = item.id;
    this.ensureKey(key);
    if (this.present[key] !== this.epoch) {
      this.insert(item, key, 0);
    }
  }

  /**
   * The items that have an entry, in the order they first got one. The
   * array is reused: it is valid until the next change to the buffer.
   */
  entryItems(): ReadonlyArray<AugmentedCRDTItem> {
    const epoch = this.epoch;
    const items = this.items;
    let length = 0;
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      if (this.present[item.id] === epoch) {
        items[length++] = item;
      } else {
        this.listed[item.id] = 0;
      }
    }
    items.length = length;
    return items;
  }

  /** The delta of an item that has an entry. */
  deltaOf(item: AugmentedCRDTItem): number {
    return this.values[item.id]!;
  }

  clear(): void {
    this.items.length = 0;
    this.entryCount = 0;
    if (this.epoch === 0xffff_ffff) {
      this.present.fill(0);
      this.listed.fill(0);
      this.epoch = 1;
      return;
    }
    this.epoch++;
  }

  private insert(item: AugmentedCRDTItem, key: number, delta: number): void {
    this.present[key] = this.epoch;
    this.values[key] = delta;
    this.entryCount++;
    if (this.listed[key] !== this.epoch) {
      this.listed[key] = this.epoch;
      this.items.push(item);
    }
  }

  private ensureKey(key: number): void {
    if (key < this.present.length) {
      return;
    }
    let capacity = this.present.length * 2;
    while (capacity <= key) {
      capacity *= 2;
    }
    this.values = grown(new Int32Array(capacity), this.values);
    this.present = grown(new Uint32Array(capacity), this.present);
    this.listed = grown(new Uint32Array(capacity), this.listed);
  }
}

const grown = <T extends Int32Array | Uint32Array>(target: T, source: T): T => {
  target.set(source);
  return target;
};
