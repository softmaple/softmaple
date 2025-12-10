/**
 * Event storage for managing document operations
 */

import { Event, EventId } from "./types";
import { CausalGraph } from "./causal-graph";
import { ColumnarStorage } from "./columnar-storage";

export class EventStorage {
  private events: Map<EventId, Event>;
  private causalGraph: CausalGraph;
  private eventOrder: Event[];
  private eventsByTimestamp: Event[];
  private columnarStorage: ColumnarStorage;

  constructor() {
    this.events = new Map();
    this.causalGraph = new CausalGraph();
    this.eventOrder = [];
    this.eventsByTimestamp = [];
    this.columnarStorage = new ColumnarStorage();
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

    // Maintain sorted array for optimizations
    const idx = this.findInsertIdx(event.timestamp || Date.now());
    this.eventsByTimestamp.splice(idx, 0, event);
  }

  private findInsertIdx(time: number): number {
    let l = 0,
      r = this.eventsByTimestamp.length;
    while (l < r) {
      const m = Math.floor((l + r) / 2);
      const event = this.eventsByTimestamp[m];
      if (event && (event.timestamp || 0) < time) {
        l = m + 1;
      } else {
        r = m;
      }
    }
    return l;
  }

  /**
   * Get an event by ID
   */
  getEvent(id: EventId): Event | undefined {
    return this.events.get(id);
  }

  /**
   * Get all events as map (for traversal optimization)
   */
  getAllEventsMap(): Map<EventId, Event> {
    return new Map(this.events);
  }

  /**
   * Get events by timestamp (optimization)
   */
  getEventsByTimestamp(): Event[] {
    return [...this.eventsByTimestamp];
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
    return orderedIds
      .map((id) => this.events.get(id)!)
      .filter((e) => e !== undefined);
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
  /** Serialize events to compact columnar format
   */
  serialize(finalDocument?: string): Uint8Array {
    const events = this.getAllEvents();
    return this.columnarStorage.serialize(events, finalDocument);
  }

  /**
   * Deserialize events from columnar format
   */
  deserialize(buffer: Uint8Array): void {
    const { events } = this.columnarStorage.deserialize(buffer);

    // Clear existing events
    this.events.clear();
    this.causalGraph = new CausalGraph();
    this.eventOrder = [];
    this.eventsByTimestamp = [];

    // Add all deserialized events
    for (const event of events) {
      this.addEvent(event);
    }
  }

  /**
   * Get storage statistics
   */
  async getStorageStatistics(): Promise<any> {
    const events = this.getAllEvents();
    return this.columnarStorage.getStatistics(events);
  }
}
