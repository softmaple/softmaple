/**
 * CRDT integration layer - RGA implementation
 */

import { EventId, AugmentedCRDTItem } from './types';

export const START_ID = 'START';
export const END_ID = 'END';

/**
 * RGA-based CRDT for managing document items
 */
export class CRDT {
  private items: AugmentedCRDTItem[];
  private itemsById: Map<EventId, AugmentedCRDTItem>;
  
  constructor() {
    this.items = [];
    this.itemsById = new Map();
  }
  
  /**
   * Find an item by its ID
   */
  findItemById(id: EventId): AugmentedCRDTItem | undefined {
    return this.itemsById.get(id);
  }
  
  /**
   * Get the previous item at a position, or null if at start
   */
  getPrevItem(position: number): AugmentedCRDTItem | null {
    if (position === 0) return null;
    return this.items[position - 1] || null;
  }
  
  /**
  * Find the next item that matches a condition
  */
 getNextItem(startPos: number, predicate: (item: AugmentedCRDTItem) => boolean): AugmentedCRDTItem | null {
   for (let i = startPos; i < this.items.length; i++) {
      const item = this.items[i];
      if (item && predicate(item)) {
        return item;
     }
   }
   return null;
 }
  
  /**
   * Integrate a new item into the CRDT using RGA rules
   */
  integrate(item: AugmentedCRDTItem): void {
    this.itemsById.set(item.id, item);
    
    // Find the correct insertion position using RGA rules
    let insertPos = 0;
    
   // Start from the position after originLeft
  if (item.originLeft && item.originLeft !== START_ID) {
    for (let i = 0; i < this.items.length; i++) {
        const currentItem = this.items[i];
        if (currentItem && currentItem.id === item.originLeft) {
        insertPos = i + 1;
        break;
      }
     }
   }
   
   // Scan forward until we find the correct position
   while (insertPos < this.items.length) {
     const current = this.items[insertPos];
      if (!current) {
        break;
      }
     
     // Stop if we've reached originRight
      if (item.originRight && current && current.id === item.originRight) {
       break;
     }
     
     // RGA ordering: compare items that were concurrently inserted
      if (this.shouldComeAfter(item, current!)) {
       insertPos++;
      } else {
        break;
      }
    }
    
    // Insert the item at the determined position
    this.items.splice(insertPos, 0, item);
  }
  
  /**
   * RGA comparison for concurrent insertions
   * Returns true if 'item' should come after 'other'
   */
  private shouldComeAfter(item: AugmentedCRDTItem, other: AugmentedCRDTItem): boolean {
    // Items with the same origin should be ordered by ID (tie-breaker)
    if (item.originLeft === other.originLeft && item.originRight === other.originRight) {
      return item.id > other.id;
    }
    
    // Check if other was inserted between item's origins
    if (other.originLeft === item.originLeft || other.originRight === item.originRight) {
      return false;
    }
    
    // Default: maintain current order
    return true;
  }
  
  /**
   * Get all items in order
   */
  getItems(): AugmentedCRDTItem[] {
    return this.items;
  }
  
 /**
  * Find the index of a position considering prepare state
  */
 indexOfPosition(position: number, usePrepareState: boolean): number {
   let currentPos = 0;
   
   for (let i = 0; i < this.items.length; i++) {
     const item = this.items[i];
      if (!item) {
        continue;
      }
     const space = usePrepareState 
       ? (item.prepareState === 1 ? 1 : 0)
       : (!item.everDeleted ? 1 : 0);
     
     if (currentPos === position) {
       return i;
     }
     
     currentPos += space;
   }
   
   return this.items.length;
 }
 
 /**
  * Calculate the effect position for an item at the given index
  */
 calculateEffectPosition(index: number): number {
   let position = 0;
   
   for (let i = 0; i < index && i < this.items.length; i++) {
      const item = this.items[i];
      if (item && !item.everDeleted) {
       position++;
     }
    }
    
    return position;
  }
}
