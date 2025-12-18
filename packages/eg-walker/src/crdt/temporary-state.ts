/**
 * Temporary CRDT state management for Section 3.1
 *
 * CRDT state exists only during transformations and must be
 * cleaned up when no longer needed. This module ensures the
 * temporary nature of CRDT metadata.
 */

import { OPERATION_TYPE } from "../constants/operation-types";
import type {
  CRDTItem,
  PrepareState,
  EffectState,
  EventId,
  GraphEvent,
  OrderingRule,
} from "../types";
import { NonInterleavingOrder } from "./non-interleaving";

/**
 * Temporary CRDT manager that ensures cleanup
 * Implements the "minimal and temporary internal metadata" requirement
 */
export class TemporaryCRDT {
  private items: CRDTItem[] = [];
  private itemsById: Map<EventId, CRDTItem> = new Map();
  private readonly createdAt: number;
  private destroyed = false;

  constructor(
    private readonly maxLifetime: number = 5000, // 5 seconds max
    private readonly orderingRule: OrderingRule = new NonInterleavingOrder(),
  ) {
    this.createdAt = Date.now();
    this.scheduleAutoCleanup();
  }

  /**
   * Check if this CRDT is still valid (not destroyed)
   */
  private checkValid(): void {
    if (this.destroyed) {
      throw new Error("CRDT has been destroyed");
    }

    const lifetime = Date.now() - this.createdAt;
    if (lifetime > this.maxLifetime) {
      this.destroy();
      throw new Error(
        `CRDT exceeded maximum lifetime of ${this.maxLifetime}ms`,
      );
    }
  }

  /**
   * Schedule automatic cleanup to ensure temporary nature
   */
  private scheduleAutoCleanup(): void {
    setTimeout(() => {
      if (!this.destroyed) {
        this.destroy();
      }
    }, this.maxLifetime);
  }

  /**
   * Create CRDT items from an event
   * Breaks multi-character insertions into items while preserving runs
   */
  createItemsFromEvent(event: GraphEvent): ReadonlyArray<CRDTItem> {
    this.checkValid();

    const items: CRDTItem[] = [];
    const op = event.operation;

    if (op.type === OPERATION_TYPE.INSERT) {
      // Create items for each character, but mark them as from same event
      // This preserves non-interleaving
      const text = op.text;
      
      // For first character, find neighbors at current position
      const originLeft = this.findLeftNeighbor(op.index) ?? null;
      const originRight = this.findRightNeighbor(op.index) ?? null;
      
      for (let i = 0; i < text.length; i++) {
        const itemId = `${event.id}:${i}`;
        const item: CRDTItem = {
          id: itemId,
          content: text[i] ?? "",
          // All chars from the same event should have the same originLeft and originRight
          // to ensure they stay together (non-interleaving)
          originLeft: originLeft,
          originRight: originRight,
          isDeleted: false,
          insertedBy: event.id,
        };
        items.push(item);
      }
    } else if (op.type === OPERATION_TYPE.DELETE) {
      // Mark items as deleted
      const toDelete = this.findItemsInRange(op.index, op.length);
      for (const item of toDelete) {
        items.push({
          ...item,
          isDeleted: true,
        });
      }
    }

    return items;
  }

  /**
   * Integrate items into the CRDT using RGA rules
   */
  integrate(newItems: ReadonlyArray<CRDTItem>): void {
    this.checkValid();

    // Group items by event to maintain non-interleaving
    const itemsByEvent = new Map<EventId, CRDTItem[]>();
    for (const item of newItems) {
      if (this.itemsById.has(item.id)) {
        continue; // Already integrated
      }
      const eventItems = itemsByEvent.get(item.insertedBy) || [];
      eventItems.push(item);
      itemsByEvent.set(item.insertedBy, eventItems);
    }
 
    // Integrate items event by event to preserve non-interleaving
    for (const [, eventItems] of itemsByEvent) {
      if (eventItems.length === 0) continue;
      
      // Find insertion position for the first item of this event
      const firstItem = eventItems[0];
      if (!firstItem) continue;
      
      const position = this.findInsertPosition(firstItem);
      
      // Insert all items from this event together at the same position
      let insertPos = position;
      for (const item of eventItems) {
        this.items.splice(insertPos, 0, item);
        this.itemsById.set(item.id, item);
        insertPos++;
      }
    }
  }

  /**
   * Find the correct insertion position using RGA rules
   */
  private findInsertPosition(item: CRDTItem): number {
    let left = 0;
    let right = this.items.length;

    // Start after originLeft
    if (item.originLeft) {
      for (let i = 0; i < this.items.length; i++) {
        const currentItem = this.items[i];
        if (currentItem && currentItem.id === item.originLeft) {
          left = i + 1;
          break;
        }
      }
    }

    // Stop before originRight
    if (item.originRight) {
      for (let i = left; i < this.items.length; i++) {
        const currentItem = this.items[i];
        if (currentItem && currentItem.id === item.originRight) {
          right = i;
          break;
        }
      }
    }

    // Find position between left and right using ordering rule
    for (let i = left; i < right; i++) {
      const current = this.items[i];
      if (!current) continue;

      // Items with same origin are concurrent
      if (current.originLeft === item.originLeft) {
        if (!this.orderingRule.compare(item, current)) {
          return i;
        }
      }
    }

    return right;
  }

  /**
   * Get current prepare state
   */
  getPrepareState(): PrepareState {
    this.checkValid();

    const visibleIndices = new Map<EventId, number>();
    let visibleIndex = 0;

    for (const item of this.items) {
      if (!item.isDeleted) {
        visibleIndices.set(item.id, visibleIndex++);
      }
    }

    return Object.freeze({
      items: [...this.items],
      visibleIndices,
    });
  }

  /**
   * Get current effect state
   */
  getEffectState(): EffectState {
    this.checkValid();

    const visibleItems = this.items.filter((item) => !item.isDeleted);
    const visibleText = visibleItems.map((item) => item.content).join("");

    return Object.freeze({
      items: [...this.items],
      visibleText,
    });
  }

  /**
   * Find left neighbor at position
   */
  private findLeftNeighbor(index: number): EventId | null {
    if (index === 0) return null;
    
    let visibleCount = 0;
    for (const item of this.items) {
      if (!item.isDeleted) {
        if (visibleCount === index - 1) {
          return item.id;
        }
        visibleCount++;
      }
    }
    return null;
  }

  /**
   * Find right neighbor at position
   */
  private findRightNeighbor(index: number): EventId | null {
    let visibleCount = 0;
    for (const item of this.items) {
      if (!item.isDeleted) {
        if (visibleCount === index) {
          return item.id;
        }
        visibleCount++;
      }
    }
    return null;
  }

  /**
   * Find items in range for deletion
   */
  private findItemsInRange(index: number, length: number): CRDTItem[] {
    const items: CRDTItem[] = [];
    let visibleCount = 0;

    for (const item of this.items) {
      if (!item.isDeleted) {
        if (visibleCount >= index && visibleCount < index + length) {
          items.push(item);
        }
        visibleCount++;
      }
    }

    return items;
  }

  /**
   * Destroy this CRDT and release all resources
   * This ensures no persistent CRDT metadata
   */
  destroy(): void {
    this.items = [];
    this.itemsById.clear();
    this.destroyed = true;
  }

  /**
   * Create a scoped CRDT that auto-destroys
   */
  static async withTemporaryCRDT<T>(
    fn: (crdt: TemporaryCRDT) => T | Promise<T>,
    maxLifetime?: number,
  ): Promise<T> {
    const crdt = new TemporaryCRDT(maxLifetime);
    try {
      return await fn(crdt);
    } finally {
      crdt.destroy();
    }
  }
}

/**
 * Export withTemporaryCRDT as a standalone function
 */
export const withTemporaryCRDT = TemporaryCRDT.withTemporaryCRDT;
