/**
 * Event storage for managing document operations
 */

import { Event, EventId } from './types';
import { CausalGraph } from './causal-graph';

export class EventStorage {
  private events: Map<EventId, Event>;
  private causalGraph: CausalGraph;
  private eventOrder: Event[];
  
  constructor() {
    this.events = new Map();
    this.causalGraph = new CausalGraph();
    this.eventOrder = [];
  }
  
  /**
   * Add an event to storage
   */
  addEvent(event: Event): void {
    if (this.events.has(event.id)) {
      return;
    }
    
    this.events.set(event.id, event);
    this.causalGraph.addEvent(event);
    this.eventOrder.push(event);
  }
  
  /**
   * Get an event by ID
   */
  getEvent(id: EventId): Event | undefined {
    return this.events.get(id);
  }
  
  /**
   * Check if an event exists
   */
  hasEvent(id: EventId): boolean {
    return this.events.has(id);
  }
  
  /**
   * Get all events
   */
  getAllEvents(): Event[] {
    return Array.from(this.events.values());
  }
  
  /**
   * Get events in causal order
   */
  getEventsInCausalOrder(): Event[] {
    const orderedIds = this.causalGraph.getTopologicalOrder();
    return orderedIds.map(id => this.events.get(id)!).filter(e => e !== undefined);
  }
  
  /**
   * Iterate events in causal order
   */
  *iterInCausalOrder(): Generator<Event> {
    yield* this.causalGraph.iterInCausalOrder();
  }
  
  /**
   * Get the causal graph
   */
  getCausalGraph(): CausalGraph {
    return this.causalGraph;
  }
  
  /**
   * Get the number of events
   */
  size(): number {
    return this.events.size;
  }
}
