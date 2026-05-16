/**
 * Minimal binary max-heap. The eg-walker package does not depend on a
 * priority-queue library, so internal graph traversals share this small
 * implementation instead.
 */
export class MaxHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: (left: T, right: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(value: T): void {
    this.items.push(value);
    this.siftUp(this.items.length - 1);
  }

  pop(): T | undefined {
    if (this.items.length === 0) {
      return undefined;
    }
    const top = this.items[0]!;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(this.items[index]!, this.items[parent]!) <= 0) {
        return;
      }
      const tmp = this.items[index]!;
      this.items[index] = this.items[parent]!;
      this.items[parent] = tmp;
      index = parent;
    }
  }

  private siftDown(index: number): void {
    const length = this.items.length;
    while (true) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let largest = index;
      if (
        left < length &&
        this.compare(this.items[left]!, this.items[largest]!) > 0
      ) {
        largest = left;
      }
      if (
        right < length &&
        this.compare(this.items[right]!, this.items[largest]!) > 0
      ) {
        largest = right;
      }
      if (largest === index) {
        return;
      }
      const tmp = this.items[index]!;
      this.items[index] = this.items[largest]!;
      this.items[largest] = tmp;
      index = largest;
    }
  }
}
