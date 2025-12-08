/**
 * Main Eg-walker algorithm implementation
 */

import {
  Event,
  EventId,
  EventType,
  Version,
  AugmentedCRDTItem,
  PrepareState,
  spaceInEffectState,
} from './types';
import { CausalGraph } from './causal-graph';
import { CRDT, START_ID, END_ID } from './crdt';
import { EventStorage } from './event-storage';

export class EgWalker {
  private eventStorage: EventStorage;
  private crdt: CRDT;
  private currentVersion: Version;
  private document: string[];
  
  constructor() {
    this.eventStorage = new EventStorage();
    this.crdt = new CRDT();
    this.currentVersion = new Set();
    this.document = [];
  }
  
  /**
   * Apply an event to the system
   */
  applyEvent(event: Event): void {
    this.eventStorage.addEvent(event);
    this.processEvent(event);
  }
  
  /**
   * Generate the document from all events
   */
  generateDocument(): string {
    // Reset state
    this.crdt = new CRDT();
    this.currentVersion = new Set();
    this.document = [];
    
    // Process events in causal order
    for (const event of this.eventStorage.iterInCausalOrder()) {
      this.processEvent(event);
    }
    
    return this.document.join('');
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
    this.currentVersion = new Set([event.id]);
  }
  
 /**
  * Prepare phase: retreat and advance to align with event's parent version
  */
 private prepareForEvent(event: Event): void {
   const causalGraph = this.eventStorage.getCausalGraph();
   const [onlyInCurrent, onlyInTarget] = causalGraph.diff(
     this.currentVersion,
     event.parentVersion
   );
   
   // Retreat: decrement prepare state for events only in current version
   for (const eventId of onlyInCurrent) {
     // Handle both items created by this event and deletion markers
     const items = this.crdt.getItems();
     for (const item of items) {
       if (item) {
         // Match items created by this event (e.g., "init_0", "init_1", etc.)
         if (item.id === eventId || item.id.startsWith(eventId + '_')) {
           if (item.prepareState > 0) {
             item.prepareState--;
           }
         }
       }
     }
   }
   
   // Advance: increment prepare state for events only in target version
   for (const eventId of onlyInTarget) {
     // Handle both items created by this event and deletion markers
     const items = this.crdt.getItems();
     for (const item of items) {
       if (item) {
         // Match items created by this event
         if (item.id === eventId || item.id.startsWith(eventId + '_')) {
           item.prepareState++;
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
    const content = event.content || '';
    
    // Handle multi-character content by splitting into individual characters
    for (let i = 0; i < content.length; i++) {
      // Find insertion position using prepare state
      const insertIndex = this.crdt.indexOfPosition(event.position + i, true);
      
      // Determine origin left
      const prevItem = this.crdt.getPrevItem(insertIndex);
      const originLeft = prevItem ? prevItem.id : START_ID;
      
      // Determine origin right (first item after position with prepare_state >= 1)
      const nextItem = this.crdt.getNextItem(
        insertIndex,
        (item) => item.prepareState >= PrepareState.INSERTED
      );
      const originRight = nextItem ? nextItem.id : END_ID;
      
     // Create new CRDT item with unique ID for each character
     const newItem: AugmentedCRDTItem = {
       id: `${event.id}_${i}`,
       originLeft,
       originRight,
        content: content[i] || '',
       everDeleted: false,
       prepareState: PrepareState.INSERTED,
     };
     
     // Integrate into CRDT
     this.crdt.integrate(newItem);
     
     // Update document at effect position
     const effectPosition = this.crdt.calculateEffectPosition(
       this.crdt.getItems().indexOf(newItem)
     );
      this.document.splice(effectPosition, 0, content[i] || '');
   }
 }
  
/**
 * Apply a delete operation
 */
private executeDelete(event: Event): void {
 // Find items to delete based on current document state
 const items = this.crdt.getItems();
 let visualPosition = 0;
 let foundItem: AugmentedCRDTItem | null = null;
 
  // When searching for the delete position, we need to consider the prepare state
  // to get the view of the document as it was at the event's parent version
  let searchPosition = 0;
  
 for (const item of items) {
    // Skip sentinels
   if (!item || item.content === undefined) {
     continue;
   }
   
    // Check if this item is visible in prepare state
    // An item is visible if it has prepareState >= 1 and isn't deleted
    if (item.prepareState >= PrepareState.INSERTED) {
      // Count position in the prepare-state view
      if (searchPosition === event.position && !item.everDeleted) {
       foundItem = item;
       break;
     }
      if (!item.everDeleted) {
        searchPosition++;
      }
   }
 }
 
 if (!foundItem) {
   console.warn(`Cannot delete at position ${event.position}: no item found`);
   return;
 }
 
 // Check if already deleted
 if (foundItem.everDeleted) {
   return; // Already deleted, nothing to do
 }
 
 // Mark as deleted
 foundItem.everDeleted = true;
  // Do not increment prepare state for deletion
  // foundItem.prepareState++;
  
  // Track this deletion event for the item
  const deletionItem: AugmentedCRDTItem = {
    id: event.id,
    originLeft: foundItem.id,
    originRight: foundItem.id,
    content: undefined,
    everDeleted: true,
    prepareState: PrepareState.DELETED,
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
      if (item && !item.everDeleted && item.content !== undefined) {
        this.document.push(item.content);
      }
    }
  }
 
  /**
   * Get the current document state
   */
  getDocument(): string {
    return this.document.join('');
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
