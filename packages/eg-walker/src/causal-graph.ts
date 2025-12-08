/**
 * Causal graph for tracking event dependencies and version management
 */

import { EventId, Version, Event } from './types';

export class CausalGraph {
  private events: Map<EventId, Event>;
  private children: Map<EventId, Set<EventId>>;
  private parents: Map<EventId, Set<EventId>>;
  
  constructor() {
    this.events = new Map();
    this.children = new Map();
    this.parents = new Map();
  }
  
  /**
   * Add an event to the causal graph
   */
  addEvent(event: Event): void {
    this.events.set(event.id, event);
    
    // Initialize parent/child relationships
    if (!this.children.has(event.id)) {
      this.children.set(event.id, new Set());
    }
    if (!this.parents.has(event.id)) {
      this.parents.set(event.id, new Set());
    }
    
    // Connect to parent events
    for (const parentId of event.parentVersion) {
      this.parents.get(event.id)!.add(parentId);
      
      if (!this.children.has(parentId)) {
        this.children.set(parentId, new Set());
      }
      this.children.get(parentId)!.add(event.id);
    }
  }
  
  /**
   * Get the transitive expansion of a version (all events that happened-before)
   */
  getTransitiveExpansion(version: Version): Set<EventId> {
    const expanded = new Set<EventId>();
    const toVisit = Array.from(version);
    
    while (toVisit.length > 0) {
      const eventId = toVisit.pop()!;
      if (expanded.has(eventId)) continue;
      
      expanded.add(eventId);
      
      const parents = this.parents.get(eventId);
      if (parents) {
        for (const parentId of parents) {
          if (!expanded.has(parentId)) {
            toVisit.push(parentId);
          }
        }
      }
    }
    
    return expanded;
  }
  
  /**
   * Compute the difference between two versions
   * Returns [only_in_v1, only_in_v2]
   */
  diff(v1: Version, v2: Version): [Set<EventId>, Set<EventId>] {
    const expanded1 = this.getTransitiveExpansion(v1);
    const expanded2 = this.getTransitiveExpansion(v2);
    
    const onlyInV1 = new Set<EventId>();
    const onlyInV2 = new Set<EventId>();
    
    // Find events only in v1
    for (const id of expanded1) {
      if (!expanded2.has(id)) {
        onlyInV1.add(id);
      }
    }
    
    // Find events only in v2
    for (const id of expanded2) {
      if (!expanded1.has(id)) {
        onlyInV2.add(id);
      }
    }
    
    return [onlyInV1, onlyInV2];
  }
  
  /**
   * Get events in causal order (topological sort)
   */
  *iterInCausalOrder(): Generator<Event> {
    const visited = new Set<EventId>();
    const visiting = new Set<EventId>();
    const sorted: Event[] = [];
    
    const visit = (id: EventId) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Cyclic dependency detected at ${id}`);
      }
      
      visiting.add(id);
      
      const parents = this.parents.get(id);
      if (parents) {
        for (const parentId of parents) {
          visit(parentId);
        }
      }
      
      visiting.delete(id);
      visited.add(id);
      
      const event = this.events.get(id);
      if (event) {
        sorted.push(event);
      }
    };
    
    // Visit all events
    for (const id of this.events.keys()) {
      visit(id);
    }
    
    // Yield in order
    for (const event of sorted) {
      yield event;
    }
  }
  
  getEvent(id: EventId): Event | undefined {
    return this.events.get(id);
  }
}
