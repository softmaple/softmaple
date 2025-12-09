/**
 * Performance optimizations for Eg-walker based on spec recommendations
 */

import { Event, EventId, Version } from "./types";

/**
 * Run-length encoding for consecutive operations
 */
export interface RunLengthOperation {
  type: 'insert' | 'delete';
  startPos: number;
  content?: string[];  // For inserts
  length: number;      // Number of consecutive operations
}

/**
 * Encode a sequence of events into run-length encoded operations
 * This reduces the number of individual operations we need to process
 */
export function encodeOperations(events: Event[]): RunLengthOperation[] {
  if (events.length === 0) return [];
  
  const encoded: RunLengthOperation[] = [];
  let currentRun: RunLengthOperation | null = null;
  
  for (const event of events) {
    if (event.type === 'insert') {
      const chars = event.content ? [event.content] : [];
      
      if (currentRun?.type === 'insert' && 
          currentRun.startPos + currentRun.length === event.position) {
        // Extend current insert run
        currentRun.content!.push(...chars);
        currentRun.length++;
      } else {
        // Start new insert run
        if (currentRun) encoded.push(currentRun);
        currentRun = {
          type: 'insert',
          startPos: event.position,
          content: chars,
          length: 1
        };
      }
    } else if (event.type === 'delete') {
      if (currentRun?.type === 'delete' && 
          currentRun.startPos === event.position) {
        // Extend current delete run
        currentRun.length++;
      } else {
        // Start new delete run
        if (currentRun) encoded.push(currentRun);
        currentRun = {
          type: 'delete',
          startPos: event.position,
          length: 1
        };
      }
    }
  }
  
  if (currentRun) encoded.push(currentRun);
  return encoded;
}

/**
 * Check if an event is fully ordered (can skip CRDT integration)
 * An event is fully ordered if:
 * 1. All events in its parent version happened before it
 * 2. No concurrent operations exist
 */
export function isFullyOrdered(
  event: Event, 
  parentEvents: Event[],
  currentVersion: Version
): boolean {
  // Ensure parentVersion is a Set
  const parentVersion = event.parentVersion instanceof Set 
    ? event.parentVersion 
    : new Set(Array.isArray(event.parentVersion) ? event.parentVersion : []);
  
  // If there are events in current version not in parent version,
  // we have concurrent operations
  for (const id of currentVersion) {
    if (!parentVersion.has(id)) {
      return false;
    }
  }
  
  // Check if all parent events have earlier timestamps
  // (assuming timestamp represents logical time)
  const eventTime = event.timestamp || Date.now();
  return parentEvents.every(parent => {
    const parentTime = parent.timestamp || 0;
    return parentTime < eventTime;
  });
}

/**
 * Optimized causal graph traversal using topological sort
 * This avoids redundant traversals when processing events
 */
export class OptimizedTraversal {
  private visited: Set<EventId> = new Set();
  private sorted: EventId[] = [];
  
  /**
   * Perform topological sort on events from start to end version
   */
  topologicalSort(
    events: Map<EventId, Event>,
    startVersion: Version,
    endVersion: Version
  ): EventId[] {
    // Reset state
    this.visited.clear();
    this.sorted = [];
    
    // Find events to process (between start and end)
    const toProcess = new Set<EventId>();
    for (const id of endVersion) {
      if (!startVersion.has(id)) {
        toProcess.add(id);
      }
    }
    
    // DFS for topological sort
    for (const id of toProcess) {
      if (!this.visited.has(id)) {
        this.dfsVisit(id, events);
      }
    }
    
    return this.sorted;
  }
  
  private dfsVisit(id: EventId, events: Map<EventId, Event>): void {
    this.visited.add(id);
    const event = events.get(id);
    
    if (event) {
      // Visit dependencies first (parent events)
      for (const parentId of event.parentVersion) {
        if (!this.visited.has(parentId) && events.has(parentId)) {
          this.dfsVisit(parentId, events);
        }
      }
    }
    
    // Add to sorted list after dependencies
    this.sorted.push(id);
  }
}

/**
 * Batch processor for handling multiple operations efficiently
 */
export class BatchProcessor {
  private batchSize: number;
  private pendingOps: RunLengthOperation[] = [];
  
  constructor(batchSize = 100) {
    this.batchSize = batchSize;
  }
  
  /**
   * Add operations to batch
   */
  addOperations(ops: RunLengthOperation[]): void {
    this.pendingOps.push(...ops);
  }
  
  /**
   * Process batches and return results
   */
  processBatches<T>(
    processor: (ops: RunLengthOperation[]) => T
  ): T[] {
    const results: T[] = [];
    
    for (let i = 0; i < this.pendingOps.length; i += this.batchSize) {
      const batch = this.pendingOps.slice(i, i + this.batchSize);
      results.push(processor(batch));
    }
    
    this.pendingOps = [];
    return results;
  }
  
  /**
   * Clear pending operations
   */
  clear(): void {
    this.pendingOps = [];
  }
}
