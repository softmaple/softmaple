/**
 * Columnar storage format for compact event graph serialization
 * Based on the Eg-walker paper section 3.8
 * 
 * Features:
 * - Column-oriented storage inspired by Automerge and columnar databases
 * - Variable-length integer encoding for space efficiency
 * - Run-length encoding for consecutive operations
 * - Topological sorting for efficient parent references
 */

import * as lz4 from 'lz4-wasm-nodejs';
import lz4 from 'lz4-wasm-nodejs';
import { CausalGraph } from './causal-graph';

// Variable-length integer encoding (similar to protobuf varints)
export class VarInt {
  static encode(value: number): Uint8Array {
    const bytes: number[] = [];
    while (value >= 0x80) {
      bytes.push((value & 0x7f) | 0x80);
      value >>= 7;
    }
    bytes.push(value & 0x7f);
    return new Uint8Array(bytes);
  }

  static decode(buffer: Uint8Array, offset: number = 0): [number, number] {
    let value = 0;
    let shift = 0;
    let byte: number;
    let idx = offset;
    
    do {
      if (idx >= buffer.length) {
        throw new Error('VarInt: buffer underflow');
      }
      byte = buffer[idx++];
      value |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    
    return [value, idx];
  }
}

// Run-length encoding for consecutive operations
interface RunLengthSegment {
  type: EventType;
  startPosition: number;
  length: number;
}

interface EventIdRun {
  replicaId: string;
  startSeq: number;
  count: number;
}

export class ColumnarStorage {
  private events: Event[] = [];
  private eventIndexMap: Map<EventId, number> = new Map();
  
  /**
   * Topologically sort events for efficient storage
   */
  private topologicalSort(events: Event[]): Event[] {
    const graph = new CausalGraph();
    events.forEach(e => graph.addEvent(e));
    
    const sorted: Event[] = [];
    for (const event of graph.iterInCausalOrder()) {
      sorted.push(event);
    }
    return sorted;
  }
  
  /**
   * Analyze events to find run-length segments
   */
  private findRunLengthSegments(events: Event[]): RunLengthSegment[] {
    const segments: RunLengthSegment[] = [];
    if (events.length === 0) return segments;
    
    let currentSegment: RunLengthSegment = {
      type: events[0].type,
      startPosition: events[0].position,
      length: 1
    };
    
    for (let i = 1; i < events.length; i++) {
      const event = events[i];
      const prevEvent = events[i - 1];
      
      // Check if this event continues the current run
      const isConsecutive = (
        event.type === currentSegment.type &&
        event.position === prevEvent.position + (prevEvent.type === EventType.INSERT ? 1 : 0)
      );
      
      if (isConsecutive) {
        currentSegment.length++;
      } else {
        segments.push(currentSegment);
        currentSegment = {
          type: event.type,
          startPosition: event.position,
          length: 1
        };
      }
    }
    
    segments.push(currentSegment);
    return segments;
  }
  
  /**
   * Extract content from insertion events
   */
  private extractContent(events: Event[]): string {
    const chars: string[] = [];
    for (const event of events) {
      if (event.type === EventType.INSERT && event.content) {
        // Store only first character for single-character events
        chars.push(event.content[0] || '');
      }
    }
    return chars.join('');
  }
  
  /**
   * Find parent exceptions (events that don't follow default pattern)
   */
  private findParentExceptions(events: Event[]): Map<number, EventId[]> {
    const exceptions = new Map<number, EventId[]>();
    
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const expectedParent = i > 0 ? new Set([events[i - 1].id]) : new Set();
      
      // Check if actual parents differ from expected
      const actualParents = Array.from(event.parentVersion);
      const expectedParentsArray = Array.from(expectedParent);
      
      if (actualParents.length !== expectedParentsArray.length ||
          !actualParents.every(p => expectedParent.has(p))) {
        exceptions.set(i, actualParents);
      }
    }
    
    return exceptions;
  }
  
  /**
   * Find event ID runs (consecutive events from same replica)
   */
  private findEventIdRuns(events: Event[]): EventIdRun[] {
    const runs: EventIdRun[] = [];
    if (events.length === 0) return runs;
    
    // Parse replica ID and sequence number from event ID
    const parseEventId = (id: EventId): [string, number] => {
      const match = id.match(/^(.+?)_(\d+)$/);
      if (match) {
        return [match[1], parseInt(match[2])];
      }
      // Fallback for simple IDs
      return [id, 0];
    };
    
    let [currentReplica, currentSeq] = parseEventId(events[0].id);
    let currentRun = { replicaId: currentReplica, startSeq: currentSeq, count: 1 };
    
    for (let i = 1; i < events.length; i++) {
      const [replica, seq] = parseEventId(events[i].id);
      
      if (replica === currentReplica && seq === currentSeq + 1) {
        currentRun.count++;
        currentSeq = seq;
      } else {
        runs.push(currentRun);
        currentReplica = replica;
        currentSeq = seq;
        currentRun = { replicaId: replica, startSeq: seq, count: 1 };
      }
    }
    
    runs.push(currentRun);
    return runs;
  }
  
  /**
   * Serialize events to columnar format
   */
  serialize(events: Event[], finalDocument?: string): Uint8Array {
    // Sort events topologically
    const sortedEvents = this.topologicalSort(events);
    this.events = sortedEvents;
    
    // Build index map for efficient lookups
    sortedEvents.forEach((event, index) => {
      this.eventIndexMap.set(event.id, index);
    });
    
    // Generate columns
    const runLengthSegments = this.findRunLengthSegments(sortedEvents);
    const content = this.extractContent(sortedEvents);
    const parentExceptions = this.findParentExceptions(sortedEvents);
    const eventIdRuns = this.findEventIdRuns(sortedEvents);
    
    // Build binary format with simple encoding
    const buffers: Uint8Array[] = [];
    
    // Header: magic number + version
    buffers.push(new Uint8Array([0xE7, 0x57, 0x01])); // "EW" v1
    
    // Store data as JSON for now (can optimize to binary later)
    const data = {
      segments: runLengthSegments,
      content,
      parentExceptions: Array.from(parentExceptions.entries()),
      eventIdRuns,
      finalDocument
    };
    
    const jsonStr = JSON.stringify(data);
    const jsonBytes = new TextEncoder().encode(jsonStr);
    
    // Add length prefix
    buffers.push(VarInt.encode(jsonBytes.length));
    buffers.push(jsonBytes);
    
    // Combine all buffers
    const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      result.set(buffer, offset);
      offset += buffer.length;
    }
    
    return result;
  }
  
  /**
   * Deserialize events from columnar format
   */
  deserialize(buffer: Uint8Array): { events: Event[], finalDocument?: string } {
    let offset = 0;
    
    // Check header
    if (buffer[offset] !== 0xE7 || buffer[offset + 1] !== 0x57 || buffer[offset + 2] !== 0x01) {
      throw new Error('Invalid columnar storage format');
    }
    offset += 3;
    
    // Read JSON data
    const [jsonLength, newOffset] = VarInt.decode(buffer, offset);
    offset = newOffset;
    
    const jsonBytes = buffer.slice(offset, offset + jsonLength);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const data = JSON.parse(jsonStr);
    
    // Reconstruct events
    const events: Event[] = [];
    const parentExceptions = new Map(data.parentExceptions);
    let contentIndex = 0;
    let eventIndex = 0;
    let currentRunIndex = 0;
    let currentRunOffset = 0;
    
    for (const segment of data.segments) {
      for (let i = 0; i < segment.length; i++) {
        // Get event ID from runs
        const run = data.eventIdRuns[currentRunIndex];
        const eventId = `${run.replicaId}_${run.startSeq + currentRunOffset}`;
        
        // Get parent version
        let parentVersion: Set<EventId>;
        if (parentExceptions.has(eventIndex)) {
          parentVersion = new Set(parentExceptions.get(eventIndex));
        } else if (eventIndex > 0) {
          parentVersion = new Set([events[eventIndex - 1].id]);
        } else {
          parentVersion = new Set();
        }
        
        // Create event
        const event: Event = {
          id: eventId,
          type: segment.type,
          position: segment.startPosition + i,
          parentVersion,
          timestamp: Date.now() // Placeholder
        };
        
        if (segment.type === EventType.INSERT) {
          event.content = data.content[contentIndex++];
        }
        
        events.push(event);
        eventIndex++;
        
        // Update run tracking
        currentRunOffset++;
        if (currentRunOffset >= run.count) {
          currentRunIndex++;
          currentRunOffset = 0;
        }
      }
    }
    
    return { events, finalDocument: data.finalDocument };
  }
  
  /**
   * Get size statistics for the columnar format
   */
  getStatistics(events: Event[]): {
    originalSize: number;
    compressedSize: number;
    compressionRatio: number;
    runLengthSegments: number;
    parentExceptions: number;
    eventIdRuns: number;
  } {
    // Estimate original size (rough JSON estimate)
    const originalSize = JSON.stringify(events).length;
    
    // Generate columnar format
    const compressed = this.serialize(events);
    const compressedSize = compressed.length;
    
    // Analyze structure
    const sortedEvents = this.topologicalSort(events);
    const segments = this.findRunLengthSegments(sortedEvents);
    const exceptions = this.findParentExceptions(sortedEvents);
    const runs = this.findEventIdRuns(sortedEvents);
    
    return {
      originalSize,
      compressedSize,
      compressionRatio: originalSize / compressedSize,
      runLengthSegments: segments.length,
      parentExceptions: exceptions.size,
      eventIdRuns: runs.length
    };
  }
}
