/**
 * Main Eg-walker algorithm implementation
 * 
 * Based on paper: https://arxiv.org/abs/2409.14252
 * 
 * The algorithm maintains three parts:
 * 1. Event graph: Persistent storage of all events
 * 2. Document state: Current text content (plain text file)
 * 3. Internal state: Temporary CRDT for merging (not persisted)
 */

import {
  Event,
  EventId,
  EventType,
  Version,
  AugmentedCRDTItem,
  PrepareState,
  spaceInEffectState,
} from "./types";
import { CausalGraph } from "./causal-graph";
import { CRDT, START_ID, END_ID } from "./crdt";
import { EventStorage } from "./event-storage";
import {
  encodeOperations,
  isFullyOrdered,
  OptimizedTraversal,
  BatchProcessor,
  RunLengthOperation
} from "./optimizations";

// PrepareState value for deleted items (first deletion = 2, as per PrepareState enum: >= 2 means deleted)
const DELETION_MARKER_PREPARE_STATE = 2;

// Cache for version diff operations
class VersionDiffCache {
  private cache: Map<string, [Set<EventId>, Set<EventId>]> = new Map();
  private maxSize = 100;
  
  getCacheKey(v1: Version, v2: Version): string {
    const v1Sorted = Array.from(v1).sort().join(',');
    const v2Sorted = Array.from(v2).sort().join(',');
    return `${v1Sorted}|${v2Sorted}`;
  }
  
  get(v1: Version, v2: Version): [Set<EventId>, Set<EventId>] | undefined {
    return this.cache.get(this.getCacheKey(v1, v2));
  }
  
  set(v1: Version, v2: Version, result: [Set<EventId>, Set<EventId>]): void {
    if (this.cache.size >= this.maxSize) {
      // Simple LRU: remove first entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(this.getCacheKey(v1, v2), result);
  }
  
  clear(): void {
    this.cache.clear();
  }
}

export class EgWalker {
 private eventStorage: EventStorage;
 private crdt: CRDT;
 private currentVersion: Version;
 private document: string[];
 private diffCache: VersionDiffCache;
 private deletionMarkerSet: Set<EventId>; // Track items that have deletion markers
 private traversal: OptimizedTraversal;
 private batchProcessor: BatchProcessor;
 private enableOptimizations: boolean;

 constructor() {
   this.eventStorage = new EventStorage();
   this.crdt = new CRDT();
   this.currentVersion = new Set();
   this.document = [];
   this.diffCache = new VersionDiffCache();
   this.deletionMarkerSet = new Set();
   this.traversal = new OptimizedTraversal();
   this.batchProcessor = new BatchProcessor();
   this.enableOptimizations = true;
 }

 /**
  * Enable or disable performance optimizations
  */
 setOptimizationsEnabled(enabled: boolean): void {
   this.enableOptimizations = enabled;
 }

  /**
   * Helper to ensure parentVersion is a Set
   */
  private ensureVersionIsSet(version: any): Version {
    if (version instanceof Set) return version;
    if (Array.isArray(version)) return new Set(version);
    return new Set();
  }

  /**
   * Apply an event to the system
   */
  applyEvent(event: Event): void {
    // Ensure parentVersion is a Set (handle legacy array format)
    event.parentVersion = this.ensureVersionIsSet(event.parentVersion);
    
    // Add event to storage
    this.eventStorage.addEvent(event);
    
    // Always regenerate from all events to ensure causal ordering
    // This ensures events are always processed in the correct order
    this.regenerateFromEvents();
  }

  /**
   * Check if we can skip CRDT integration (optimization)
   */
  /**
   * Regenerate document from all events in causal order
   */
  private regenerateFromEvents(): void {
    // Reset state
    this.crdt = new CRDT();
    this.currentVersion = new Set();
    this.document = [];
    this.diffCache.clear();
    this.deletionMarkerSet.clear();
    
    // Process events in causal order
    for (const event of this.eventStorage.iterInCausalOrder()) {
      this.processEvent(event);
    }
  }

  private shouldSkipCRDT(event: Event): boolean {
   if (!this.enableOptimizations) return false;
   
    const parentVersion = event.parentVersion as Version;
   
   const parentEvents: Event[] = [];
   for (const id of parentVersion) {
     const parentEvent = this.eventStorage.getEvent(id);
     if (parentEvent) parentEvents.push(parentEvent);
   }
   
   return isFullyOrdered(event, parentEvents, this.currentVersion);
 }

  /**
   * Apply event directly without CRDT (optimization for fully ordered ops)
   */
  private applyDirectly(event: Event): void {
    if (event.type === EventType.INSERT && event.content) {
      // Split content into individual characters
      for (let i = 0; i < event.content.length; i++) {
        this.document.splice(event.position + i, 0, event.content[i] || '');
      }
    } else if (event.type === EventType.DELETE && event.position < this.document.length) {
      this.document.splice(event.position, 1);
    }
    this.currentVersion.add(event.id);
  }

  /**
   * Apply multiple events in batch (optimization)
   */
  applyEventBatch(events: Event[]): void {
    if (!this.enableOptimizations || events.length < 2) {
      events.forEach(e => this.applyEvent(e));
      return;
    }
    
    // Use run-length encoding
    const encoded = encodeOperations(events);
    this.batchProcessor.addOperations(encoded);
    this.batchProcessor.processBatches(ops => {
      this.processBatchedOps(ops);
      return true;
    });
  }

  private processBatchedOps(ops: RunLengthOperation[]): void {
    for (const op of ops) {
      if (op.type === 'insert' && op.content) {
        this.document.splice(op.startPos, 0, ...op.content);
      } else if (op.type === 'delete') {
        this.document.splice(op.startPos, op.length);
      }
    }
  }

  /**
   * Generate the document from all events
   */
  generateDocument(): string {
    // Reset state
    this.crdt = new CRDT();
    this.currentVersion = new Set();
    this.document = [];
    this.diffCache.clear();
    this.deletionMarkerSet.clear();

    // Process events in causal order
    for (const event of this.eventStorage.iterInCausalOrder()) {
      this.processEvent(event);
    }

    return this.document.join("");
  }

  /**
   * Process a single event
   */
  private processEvent(event: Event): void {
    // Step 1: Prepare phase
    this.prepareForEvent(event);

   // Step 2: Apply phase
   this.executeEvent(event);

   // Update current version
    // Update current version to include all parent events plus this event
    for (const parentId of event.parentVersion) {
      this.currentVersion.add(parentId);
    }
    this.currentVersion.add(event.id);
 }

  /**
   * Prepare phase: retreat and advance to align with event's parent version
   */
  private prepareForEvent(event: Event): void {
    // Try cache first
    let diff = this.diffCache.get(this.currentVersion, event.parentVersion);
    
    if (!diff) {
      const causalGraph = this.eventStorage.getCausalGraph();
      diff = causalGraph.diff(this.currentVersion, event.parentVersion);
      this.diffCache.set(this.currentVersion, event.parentVersion, diff);
    }
    
    const [onlyInCurrent, onlyInTarget] = diff;

    // Retreat: decrement prepare state for events only in current version
    const items = this.crdt.getItems();

    for (const eventId of onlyInCurrent) {
      // Handle prepare state changes - simple approach
      for (const item of items) {
        if (item) {
          // Match items created by this event (e.g., "init_0", "init_1", etc.)
          if (item.id === eventId || item.id.startsWith(eventId + "_")) {
            if (item.prepareState > 0) {
              item.prepareState--;
            }
          }
        }
      }
      
      // Handle deletion markers - remove them from the set when retreating
      const retreatEvent = this.eventStorage.getEvent(eventId);
      if (retreatEvent && retreatEvent.type === EventType.DELETE) {
        // Find item that was deleted and temporarily restore for prepare view
        for (const item of items) {
          if (item && item.id === eventId && item.originLeft) {
            // Remove from deletion marker set to make it visible
            this.deletionMarkerSet.delete(item.originLeft);
            // Find the actual item and restore it temporarily
            for (const targetItem of items) {
              if (targetItem && targetItem.id === item.originLeft) {
                targetItem.everDeleted = false;
              }
            }
          }
        }
      }
    }

    // Advance: increment prepare state for events only in target version
    for (const eventId of onlyInTarget) {
      // Handle prepare state changes
      for (const item of items) {
        if (item) {
          // Match items created by this event
          if (item.id === eventId || item.id.startsWith(eventId + "_")) {
            item.prepareState++;
          }
        }
      }
      
      // Handle deletion markers - add them to the set when advancing
      const advanceEvent = this.eventStorage.getEvent(eventId);
      if (advanceEvent && advanceEvent.type === EventType.DELETE) {
        // Find the deletion marker and apply the deletion
        for (const item of items) {
          if (item && item.id === eventId && item.originLeft) {
            // Add to deletion marker set
            this.deletionMarkerSet.add(item.originLeft);
            // Find the actual item and mark as deleted
            for (const targetItem of items) {
              if (targetItem && targetItem.id === item.originLeft) {
                targetItem.everDeleted = true;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Apply phase: execute the event operation
   */
  private executeEvent(event: Event): void {
    if (event.type === EventType.INSERT) {
      this.executeInsert(event);
    } else if (event.type === EventType.DELETE) {
      this.executeDelete(event);
    }
  }

  /**
   * Apply an insert operation
   */
  private executeInsert(event: Event): void {
    const content = event.content || "";
    
    // Optimization for empty content
    if (!content) return;

    // Handle multi-character content by splitting into individual characters
    // Find the initial insertion position once
    // Count visible items to handle out-of-bounds positions gracefully
    const items = this.crdt.getItems();
    let visibleCount = 0;
    for (const item of items) {
      if (item && item.content !== undefined && item.prepareState >= PrepareState.INSERTED && !item.everDeleted && !this.deletionMarkerSet.has(item.id)) {
        visibleCount++;
      }
    }
    
    // Clamp position to valid range (0 to visibleCount)
    const clampedPosition = Math.min(event.position, visibleCount);
    const initialInsertIndex = this.crdt.indexOfPosition(clampedPosition, true);

    // Get the initial left and right origins based on the insertion position
    const initialPrevItem = this.crdt.getPrevItem(initialInsertIndex);
    const initialOriginLeft = initialPrevItem ? initialPrevItem.id : START_ID;

    const initialNextItem = this.crdt.getNextItem(
      initialInsertIndex,
      (item) => item.prepareState >= PrepareState.INSERTED,
    );
    const initialOriginRight = initialNextItem ? initialNextItem.id : END_ID;

    // Batch create items for multi-character content
    const newItems: AugmentedCRDTItem[] = [];
    let previousItemId = initialOriginLeft;

    for (let i = 0; i < content.length; i++) {
      // For each character after the first, the originLeft is the previous character
      // and originRight is the original right boundary to keep them together
      const originLeft = i === 0 ? initialOriginLeft : previousItemId;
      const originRight = initialOriginRight;

      // Create new CRDT item with unique ID for each character
      const itemId = `${event.id}_${i}`;
      const newItem: AugmentedCRDTItem = {
        id: itemId,
        originLeft,
        originRight,
        content: content[i] || "",
        everDeleted: false,
        prepareState: PrepareState.INSERTED,
      };

      previousItemId = itemId;
      newItems.push(newItem);
    }

    // Batch integrate all items
    for (const newItem of newItems) {
      this.crdt.integrate(newItem);
    }
    
    // Regenerate document after batch insert
    this.regenerateDocument();
  }

  /**
   * Apply a delete operation
   */
  private executeDelete(event: Event): void {
    // Find items to delete based on current document state
    const items = this.crdt.getItems();
    let foundItem: AugmentedCRDTItem | null = null;

    // When searching for the delete position, we need to consider the prepare state
    // to get the view of the document as it was at the event's parent version
    let visiblePosition = 0;

    for (const item of items) {
      // Skip sentinels
      if (!item || item.content === undefined) {
        continue;
      }

      // Check if this item is visible in prepare state
      // An item is visible if it has prepareState >= 1 and isn't deleted
      if (item.prepareState >= PrepareState.INSERTED && !item.everDeleted && !this.deletionMarkerSet.has(item.id)) {
        // Count position in the prepare-state view
        if (visiblePosition === event.position) {
          foundItem = item;
          break;
        }
        visiblePosition++;
      }
    }

    if (!foundItem) {
      console.warn(
        `Cannot delete at position ${event.position}: no item found`,
      );
      return;
    }

    // Check if already deleted
    if (foundItem.everDeleted || this.deletionMarkerSet.has(foundItem.id)) {
      return; // Already deleted, nothing to do
    }

    // Mark as deleted
    foundItem.everDeleted = true;
    this.deletionMarkerSet.add(foundItem.id);
    // Do not increment prepare state for deletion
    // foundItem.prepareState++;

    // Track this deletion event for the item
    const deletionItem: AugmentedCRDTItem = {
      id: event.id,
      originLeft: foundItem.id,
      originRight: foundItem.id,
      content: undefined,
      everDeleted: true,
      prepareState: DELETION_MARKER_PREPARE_STATE, // Mark as deleted (PrepareState >= 2 means deleted)
    };
    this.crdt.integrate(deletionItem);

    // Regenerate document from CRDT state
    this.regenerateDocument();
  }

  /**
   * Regenerate document from CRDT items
   */
  private regenerateDocument(): void {
    this.document = [];
    const items = this.crdt.getItems();

    for (const item of items) {
      // Skip deleted items and sentinels
      if (item && !item.everDeleted && !this.deletionMarkerSet.has(item.id) && item.content !== undefined) {
        this.document.push(item.content);
      }
    }
  }

  /**
   * Get the current document state
   */
  getDocument(): string {
    return this.document.join("");
  }

  /**
   * Get the current version
   */
  getCurrentVersion(): Version {
    return new Set(this.currentVersion);
  }

  /**
   * Get all events
   */
  getEvents(): Event[] {
    return this.eventStorage.getAllEvents();
  }
}
