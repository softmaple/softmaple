/**
 * Performance benchmarks for eg-walker optimizations
 */

import { describe, it, beforeEach, expect } from 'vitest';
import { EgWalker } from '../eg-walker';
import { Event, EventType } from '../types';

describe('EgWalker Performance Benchmarks', () => {
  let walker: EgWalker;
  let walkerNoOpt: EgWalker;
  
  beforeEach(() => {
    walker = new EgWalker();
    walkerNoOpt = new EgWalker();
    walkerNoOpt.setOptimizationsEnabled(false);
  });
  
  it('should handle sequential inserts faster with optimizations', () => {
    const numOps = 1000;
    const events: Event[] = [];
    
    // Create sequential insert events
    for (let i = 0; i < numOps; i++) {
      events.push({
        id: `seq_${i}`,
        type: EventType.INSERT,
        position: i,
        content: String.fromCharCode(97 + (i % 26)),
        parentVersion: i === 0 ? new Set() : new Set([`seq_${i - 1}`]),
        timestamp: i
      });
    }
    
    // Benchmark with optimizations
    const startOpt = performance.now();
    walker.applyEventBatch(events);
    const timeOpt = performance.now() - startOpt;
    
    // Benchmark without optimizations
    const startNoOpt = performance.now();
    for (const event of events) {
      walkerNoOpt.applyEvent(event);
    }
    const timeNoOpt = performance.now() - startNoOpt;
    
    console.log(`Sequential inserts (${numOps} ops):`);
    console.log(`  With optimizations: ${timeOpt.toFixed(2)}ms`);
    console.log(`  Without optimizations: ${timeNoOpt.toFixed(2)}ms`);
    console.log(`  Speedup: ${(timeNoOpt / timeOpt).toFixed(2)}x`);
    
    // Optimized should be faster
    expect(timeOpt).toBeLessThan(timeNoOpt);
  });
  
  it('should handle consecutive deletes faster with run-length encoding', () => {
    const numOps = 500;
    
    // First, insert some content
    const setupEvents: Event[] = [];
    for (let i = 0; i < numOps; i++) {
      setupEvents.push({
        id: `init_${i}`,
        type: EventType.INSERT,
        position: i,
        content: 'x',
        parentVersion: i === 0 ? new Set() : new Set([`init_${i - 1}`]),
        timestamp: i
      });
    }
    
    walker.applyEventBatch(setupEvents);
    for (const event of setupEvents) {
      walkerNoOpt.applyEvent(event);
    }
    
    // Now create consecutive delete events
    const deleteEvents: Event[] = [];
    for (let i = 0; i < numOps / 2; i++) {
      deleteEvents.push({
        id: `del_${i}`,
        type: EventType.DELETE,
        position: 0, // Always delete from beginning (consecutive)
        parentVersion: new Set([`init_${numOps - 1}`]),
        timestamp: numOps + i
      });
    }
    
    // Benchmark with optimizations
    const startOpt = performance.now();
    walker.applyEventBatch(deleteEvents);
    const timeOpt = performance.now() - startOpt;
    
    // Benchmark without optimizations
    const startNoOpt = performance.now();
    for (const event of deleteEvents) {
      walkerNoOpt.applyEvent(event);
    }
    const timeNoOpt = performance.now() - startNoOpt;
    
    console.log(`Consecutive deletes (${deleteEvents.length} ops):`);
    console.log(`  With optimizations: ${timeOpt.toFixed(2)}ms`);
    console.log(`  Without optimizations: ${timeNoOpt.toFixed(2)}ms`);
    console.log(`  Speedup: ${(timeNoOpt / timeOpt).toFixed(2)}x`);
    
    expect(timeOpt).toBeLessThan(timeNoOpt);
  });
  
  it('should skip CRDT for fully ordered operations', () => {
    const numOps = 500;
    const events: Event[] = [];
    
    // Create fully ordered events (sequential timestamps, linear parent chain)
    for (let i = 0; i < numOps; i++) {
      events.push({
        id: `ordered_${i}`,
        type: EventType.INSERT,
        position: i,
        content: 'a',
        parentVersion: i === 0 ? new Set() : new Set([`ordered_${i - 1}`]),
        timestamp: i * 10 // Strictly increasing timestamps
      });
    }
    
    // Benchmark with optimization (should skip CRDT)
    const startOpt = performance.now();
    for (const event of events) {
      walker.applyEvent(event);
    }
    const timeOpt = performance.now() - startOpt;
    
    // Benchmark without optimization (uses CRDT)
    const startNoOpt = performance.now();
    for (const event of events) {
      walkerNoOpt.applyEvent(event);
    }
    const timeNoOpt = performance.now() - startNoOpt;
    
    console.log(`Fully ordered operations (${numOps} ops):`);
    console.log(`  With CRDT skip: ${timeOpt.toFixed(2)}ms`);
   console.log(`  Without CRDT skip: ${timeNoOpt.toFixed(2)}ms`);
   console.log(`  Speedup: ${(timeNoOpt / timeOpt).toFixed(2)}x`);
   
    // Skip strict performance assertions in CI environments
    if (!process.env.CI) {
      // Run multiple iterations for stable comparison
      const iterations = 10;
      const timesOpt: number[] = [];
      const timesNoOpt: number[] = [];
      
      for (let i = 0; i < iterations; i++) {
       const walker1 = new EgWalker();
       walker1.setOptimizationsEnabled(true);
       const start1 = performance.now();
        for (const event of events) {
          walker1.applyEvent(event);
       }
       timesOpt.push(performance.now() - start1);
       
       const walker2 = new EgWalker();
       walker2.setOptimizationsEnabled(false);
       const start2 = performance.now();
        for (const event of events) {
          walker2.applyEvent(event);
       }
       timesNoOpt.push(performance.now() - start2);
      }
      
      const avgOpt = timesOpt.reduce((a, b) => a + b, 0) / iterations;
      const avgNoOpt = timesNoOpt.reduce((a, b) => a + b, 0) / iterations;
      
      // Expect optimized version to be at least 10% faster on average
      expect(avgOpt).toBeLessThan(avgNoOpt * 0.9);
    }
  });
  
  it('should handle concurrent operations with optimized traversal', () => {
    // Create a diamond pattern of concurrent operations
    const base: Event = {
      id: 'base',
      type: EventType.INSERT,
      position: 0,
      content: 'base',
      parentVersion: new Set(),
      timestamp: 0
    };
    
    // Two concurrent branches
    const branch1Events: Event[] = [];
    const branch2Events: Event[] = [];
    
    for (let i = 0; i < 100; i++) {
      branch1Events.push({
        id: `b1_${i}`,
        type: EventType.INSERT,
        position: i + 1,
        content: 'x',
        parentVersion: i === 0 ? new Set(['base']) : new Set([`b1_${i - 1}`]),
        timestamp: 100 + i
      });
      
      branch2Events.push({
        id: `b2_${i}`,
        type: EventType.INSERT,
        position: i + 1,
        content: 'y',
        parentVersion: i === 0 ? new Set(['base']) : new Set([`b2_${i - 1}`]),
        timestamp: 200 + i
      });
    }
    
    // Merge event
    const merge: Event = {
      id: 'merge',
      type: EventType.INSERT,
      position: 0,
      content: 'M',
      parentVersion: new Set(['b1_99', 'b2_99']),
      timestamp: 300
    };
    
    // Apply with optimizations
    const startOpt = performance.now();
    walker.applyEvent(base);
    walker.applyEventBatch(branch1Events);
    walker.applyEventBatch(branch2Events);
    walker.applyEvent(merge);
    const timeOpt = performance.now() - startOpt;
    
    // Apply without optimizations
    const startNoOpt = performance.now();
    walkerNoOpt.applyEvent(base);
    for (const e of branch1Events) walkerNoOpt.applyEvent(e);
    for (const e of branch2Events) walkerNoOpt.applyEvent(e);
    walkerNoOpt.applyEvent(merge);
    const timeNoOpt = performance.now() - startNoOpt;
    
    console.log(`Concurrent operations (201 ops):`);
    console.log(`  With optimizations: ${timeOpt.toFixed(2)}ms`);
    console.log(`  Without optimizations: ${timeNoOpt.toFixed(2)}ms`);
    console.log(`  Speedup: ${(timeNoOpt / timeOpt).toFixed(2)}x`);
    
    expect(walker.getDocument()).toBe(walkerNoOpt.getDocument());
  });
});
