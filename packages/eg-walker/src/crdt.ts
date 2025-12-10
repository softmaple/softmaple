/**
 * CRDT integration layer - RGA implementation with performance optimizations
 */

import { EventId, AugmentedCRDTItem } from './types';

export const START_ID = 'START';
export const END_ID = 'END';

/**
 * RGA-based CRDT for managing document items with optimizations:
 * - Position caching for O(1) ID lookups
 * - Batch operations support
 * - Incremental updates
 */
export class CRDT {
  private items: AugmentedCRDTItem[];
  private itemsById: Map<EventId, AugmentedCRDTItem>;
  private positionCache: Map<EventId, number>;
  private cacheValid: boolean;
  
  constructor() {
    this.items = [];
    this.itemsById = new Map();
    this.positionCache = new Map();
    this.cacheValid = true;
    
    // Initialize with start and end sentinels
    const startSentinel: AugmentedCRDTItem = {
      id: START_ID,
      originLeft: null,
      originRight: null,
      content: undefined,
      everDeleted: false,
      prepareState: 1
    };
    
    const endSentinel: AugmentedCRDTItem = {
      id: END_ID,
      originLeft: START_ID,
      originRight: null,
      content: undefined,
      everDeleted: false,
      prepareState: 1
    };
    
    this.items.push(startSentinel);
    this.items.push(endSentinel);
    this.itemsById.set(START_ID, startSentinel);
    this.itemsById.set(END_ID, endSentinel);
    this.updatePositionCache(0);
  }
  
  /**
   * Update position cache from a specific index
   */
  private updatePositionCache(fromIndex: number = 0): void {
    for (let i = fromIndex; i < this.items.length; i++) {
      const item = this.items[i];
      if (item) {
        this.positionCache.set(item.id, i);
      }
    }
    this.cacheValid = true;
  }
  
  /**
   * Invalidate cache
   */
  private invalidateCache(): void {
    this.cacheValid = false;
  }
  
  /**
   * Find an item by its ID - O(1)
   */
  findItemById(id: EventId): AugmentedCRDTItem | undefined {
    return this.itemsById.get(id);
  }
  
  /**
   * Find position of item by ID - O(1) with cache
   */
  findPositionById(id: EventId): number | undefined {
    if (!this.cacheValid) {
      this.updatePositionCache();
    }
    return this.positionCache.get(id);
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
   * Integrate a new item into the CRDT using RGA rules - Optimized version
   */
  integrate(item: AugmentedCRDTItem): void {
    // Prevent duplicate IDs
    if (this.itemsById.has(item.id)) {
      return;
    }
    
    this.itemsById.set(item.id, item);
    
    // Use cached position for O(1) lookup of originLeft
    let insertPos = 0;
    if (item.originLeft) {
      const leftPos = this.findPositionById(item.originLeft);
      if (leftPos !== undefined) {
        insertPos = leftPos + 1;
      }
    }
    
    // Scan forward until we find the correct position
    while (insertPos < this.items.length) {
      const currentItem = this.items[insertPos];
      if (!currentItem) break;
      
      // Stop at originRight
      if (currentItem.id === item.originRight) {
        break;
      }
      
      // RGA ordering: compare items at same position
      if (currentItem.originLeft === item.originLeft) {
        if (!this.shouldComeAfter(item, currentItem)) {
          break;
        }
      }
      
      insertPos++;
    }
    
    // Insert the item
    this.items.splice(insertPos, 0, item);
    
    // Update position cache incrementally
    this.updatePositionCache(insertPos);
  }
  
  /**
   * Batch integrate multiple items - reduces overhead
   */
  integrateBatch(items: AugmentedCRDTItem[]): void {
    // Sort items by their expected positions to minimize cache rebuilds
    const sortedItems = [...items].sort((a, b) => {
      // Simple heuristic: items with same originLeft are likely adjacent
      if (a.originLeft === b.originLeft) {
        return this.shouldComeAfter(a, b) ? 1 : -1;
      }
      return 0;
    });
    
    for (const item of sortedItems) {
      this.integrate(item);
    }
  }
  
  /**
   * Determine if item1 should come after item2 in RGA ordering
   */
  private shouldComeAfter(item1: AugmentedCRDTItem, item2: AugmentedCRDTItem): boolean {
    // Lexicographic comparison of IDs for deterministic ordering
    return item1.id > item2.id;
  }
  
  /**
   * Find index position based on visible item count - Optimized with early exit
   */
  indexOfPosition(position: number, useEffectState: boolean = false): number {
    let visibleCount = 0;
    
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!item || item.id === START_ID || item.id === END_ID) {
        continue;
      }
      
      // Skip deletion markers
      if (item.content === undefined) {
        continue;
      }
      
      const isVisible = useEffectState 
        ? !item.everDeleted 
        : item.prepareState >= 1;
      
      if (isVisible) {
        if (visibleCount === position) {
          return i;
        }
        visibleCount++;
      }
    }
    
    return this.items.length - 1;
  }
  
  /**
   * Calculate position in effect state - Optimized version
   */
  calculateEffectPosition(crdtIndex: number): number {
    let position = 0;
    
    for (let i = 0; i < crdtIndex && i < this.items.length; i++) {
      const item = this.items[i];
      if (item && item.content !== undefined && !item.everDeleted) {
        position++;
      }
    }
    
    return position;
  }
  
  /**
   * Get all items
   */
  getItems(): (AugmentedCRDTItem | null)[] {
    return this.items;
  }
  
  /**
   * Get item at specific index
   */
  getItemAt(index: number): AugmentedCRDTItem | null {
    return this.items[index] || null;
  }
  
  /**
   * Get total number of items
   */
  getLength(): number {
    return this.items.length;
  }
  
  /**
   * Clear the CRDT (for testing)
   */
  clear(): void {
    this.items = [];
    this.itemsById.clear();
    this.positionCache.clear();
    this.cacheValid = true;
  }

  /**
   * Get position at prepare state (visible position counting only items with prepareState >= 1)
   */
  getPositionAtPrepareState(position: number): number {
    let visibleCount = 0;
    
    // Count visible items up to the requested position
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      
      // Skip sentinels and non-content items
      if (!item || item.id === START_ID || item.id === END_ID || item.content === undefined) {
        continue;
      }
      
      // Count items that are visible at prepare state
      if (item.prepareState >= 1) {
        if (visibleCount === position) {
          // Return the visible position, not the CRDT index
          return visibleCount;
        }
        visibleCount++;
      }
    }
    
    // If position is beyond available items, return the count of visible items
    return visibleCount;
  }

  /**
   * Get position at effect state (visible position counting only non-deleted items)
   */
  getPositionAtEffectState(position: number): number {
    let visibleCount = 0;
    
    // Count visible items up to the requested position
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      
      // Skip sentinels and non-content items
      if (!item || item.id === START_ID || item.id === END_ID || item.content === undefined) {
        continue;
      }
      
      // Count items that are visible at effect state (not deleted)
      if (!item.everDeleted) {
        if (visibleCount === position) {
          // Return the visible position
          return visibleCount;
        }
        visibleCount++;
      }
    }
    
    // If position is beyond available items, return the count of visible items
    return visibleCount;
  }
}
