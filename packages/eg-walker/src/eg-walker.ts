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
   * Add an event to the system
   */
  addEvent(event: Event): void {
    this.eventStorage.addEvent(event);
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
    this.applyEvent(event);
    
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
      const item = this.crdt.findItemById(eventId);
      if (item) {
        item.prepareState--;
      }
    }
    
    // Advance: increment prepare state for events only in target version
    for (const eventId of onlyInTarget) {
      const item = this.crdt.findItemById(eventId);
      if (item) {
        item.prepareState++;
      }
    }
  }
  
  /**
   * Apply phase: execute the event operation
   */
  private applyEvent(event: Event): void {
    if (event.type === EventType.INSERT) {
      this.applyInsert(event);
    } else if (event.type === EventType.DELETE) {
      this.applyDelete(event);
    }
  }
  
 /**
  * Apply an insert operation
  */
 private applyInsert(event: Event): void {
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
  private applyDelete(event: Event): void {
   // Find the item at the position (in prepare state)
   let index = this.crdt.indexOfPosition(event.position, true);
   const items = this.crdt.getItems();
   
  // Skip items that aren't in the inserted state
    while (index < items.length) {
     const currentItem = items[index];
     if (!currentItem || currentItem.prepareState === PrepareState.INSERTED) {
       break;
     }
    index++;
  }
  
    const item = items[index];
    if (!item) {
    console.warn(`Cannot delete at position ${event.position}: no item found`);
    return;
  }
   
   // Mark as deleted
   item.everDeleted = true;
    item.prepareState++; // Increment to mark as deleted in prepare state
    
   // Update document at effect position
   const effectPosition = this.crdt.calculateEffectPosition(index);
   
    // Remove from document array at the calculated effect position
    if (effectPosition >= 0 && effectPosition < this.document.length) {
      this.document.splice(effectPosition, 1);
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
