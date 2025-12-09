import { describe, it, expect, beforeEach } from 'vitest';
import { EventStorage } from '../event-storage';
import { EventType } from '../types';
import type { Event } from '../types';

describe('EventStorage', () => {
  let storage: EventStorage;

  beforeEach(() => {
    storage = new EventStorage();
  });

  describe('addEvent', () => {
    it('should add a single event', () => {
      const event: Event = {
        id: 'e1',
        type: EventType.INSERT,
        position: 0,
        content: 'a',
        parentVersion: new Set([]),
        timestamp: Date.now()
      };

      storage.addEvent(event);
      const retrieved = storage.getEvent('e1');
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe('a');
    });

    it('should prevent duplicate events', () => {
      const event: Event = {
        id: 'duplicate',
        type: EventType.INSERT,
        position: 0,
        content: 'first',
        parentVersion: new Set([]),
        timestamp: 100
      };

      const duplicate: Event = {
        id: 'duplicate',
        type: EventType.INSERT,
        position: 1,
        content: 'second',
        parentVersion: new Set([]),
        timestamp: 200
      };

      storage.addEvent(event);
      storage.addEvent(duplicate);

      const retrieved = storage.getEvent('duplicate');
      expect(retrieved?.content).toBe('first'); // Should keep the first one
    });

    it('should track multiple events', () => {
      for (let i = 0; i < 10; i++) {
        storage.addEvent({
          id: `event${i}`,
          type: EventType.INSERT,
          position: i,
          content: String(i),
          parentVersion: i === 0 ? [] : [`event${i - 1}`],
          timestamp: i * 100
        });
      }

      expect(storage.getAllEvents()).toHaveLength(10);
    });
  });

  describe('getEvent', () => {
    it('should retrieve existing events', () => {
      const event: Event = {
        id: 'test',
        type: EventType.DELETE,
        position: 5,
        parentVersion: new Set(['parent']),
        timestamp: 1000
      };

      storage.addEvent(event);
      const retrieved = storage.getEvent('test');
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.type).toBe('delete');
      expect(retrieved?.position).toBe(5);
    });

    it('should return undefined for non-existent events', () => {
      const retrieved = storage.getEvent('non-existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('getAllEvents', () => {
    it('should return empty array initially', () => {
      expect(storage.getAllEvents()).toHaveLength(0);
    });

    it('should return all added events', () => {
      const events: Event[] = [
        {
          id: 'e1',
          type: EventType.INSERT,
          position: 0,
          content: 'a',
          parentVersion: new Set([]),
          timestamp: 100
        },
        {
          id: 'e2',
          type: EventType.INSERT,
          position: 1,
          content: 'b',
          parentVersion: new Set(['e1']),
          timestamp: 200
        },
        {
          id: 'e3',
          type: EventType.DELETE,
          position: 0,
          parentVersion: new Set(['e2']),
          timestamp: 300
        }
      ];

      events.forEach(e => storage.addEvent(e));
      const allEvents = storage.getAllEvents();
      
      expect(allEvents).toHaveLength(3);
      expect(allEvents.map(e => e.id)).toContain('e1');
      expect(allEvents.map(e => e.id)).toContain('e2');
      expect(allEvents.map(e => e.id)).toContain('e3');
    });
  });

  describe('getEventsInCausalOrder', () => {
    it('should return events in causal order', () => {
      // Create a simple chain: e1 -> e2 -> e3
      const e1: Event = {
        id: 'e1',
        type: EventType.INSERT,
        position: 0,
        content: 'a',
        parentVersion: new Set([]),
        timestamp: 100
      };

      const e2: Event = {
        id: 'e2',
        type: EventType.INSERT,
        position: 1,
        content: 'b',
        parentVersion: new Set(['e1']),
        timestamp: 200
      };

      const e3: Event = {
        id: 'e3',
        type: EventType.INSERT,
        position: 2,
        content: 'c',
        parentVersion: new Set(['e2']),
        timestamp: 300
      };

      // Add in reverse order to test sorting
      storage.addEvent(e3);
      storage.addEvent(e1);
      storage.addEvent(e2);

      const ordered = storage.getEventsInCausalOrder();
      
      expect(ordered[0].id).toBe('e1');
      expect(ordered[1].id).toBe('e2');
      expect(ordered[2].id).toBe('e3');
    });

    it('should handle concurrent events', () => {
      // Create concurrent branches
      const root: Event = {
        id: 'root',
        type: EventType.INSERT,
        position: 0,
        content: 'r',
        parentVersion: new Set([]),
        timestamp: 100
      };

      const branch1: Event = {
        id: 'branch1',
        type: EventType.INSERT,
        position: 1,
        content: 'b1',
        parentVersion: new Set(['root']),
        timestamp: 200
      };

      const branch2: Event = {
        id: 'branch2',
        type: EventType.INSERT,
        position: 1,
        content: 'b2',
        parentVersion: new Set(['root']),
        timestamp: 200
      };

      storage.addEvent(branch2);
      storage.addEvent(root);
      storage.addEvent(branch1);

      const ordered = storage.getEventsInCausalOrder();
      
      // Root should come first
      expect(ordered[0].id).toBe('root');
      
      // Both branches should come after root
      const branch1Index = ordered.findIndex(e => e.id === 'branch1');
      const branch2Index = ordered.findIndex(e => e.id === 'branch2');
      expect(branch1Index).toBeGreaterThan(0);
      expect(branch2Index).toBeGreaterThan(0);
    });

    it('should handle complex diamond pattern', () => {
      // Diamond: root -> (a, b) -> merge
      const root: Event = {
        id: 'root',
        type: EventType.INSERT,
        position: 0,
        content: 'root',
        parentVersion: new Set([]),
        timestamp: 100
      };

      const a: Event = {
        id: 'a',
        type: EventType.INSERT,
        position: 1,
        content: 'a',
        parentVersion: new Set(['root']),
        timestamp: 200
      };

      const b: Event = {
        id: 'b',
        type: EventType.INSERT,
        position: 1,
        content: 'b',
        parentVersion: new Set(['root']),
        timestamp: 300
      };

      const merge: Event = {
        id: 'merge',
        type: EventType.INSERT,
        position: 2,
        content: 'merge',
        parentVersion: new Set(['a', 'b']),
        timestamp: 400
      };

      // Add in random order
      storage.addEvent(merge);
      storage.addEvent(a);
      storage.addEvent(root);
      storage.addEvent(b);

      const ordered = storage.getEventsInCausalOrder();
      
      // Root must come first
      expect(ordered[0].id).toBe('root');
      
      // Merge must come last
      expect(ordered[ordered.length - 1].id).toBe('merge');
      
      // a and b must come between root and merge
      const aIndex = ordered.findIndex(e => e.id === 'a');
      const bIndex = ordered.findIndex(e => e.id === 'b');
      const mergeIndex = ordered.findIndex(e => e.id === 'merge');
      
      expect(aIndex).toBeGreaterThan(0);
      expect(aIndex).toBeLessThan(mergeIndex);
      expect(bIndex).toBeGreaterThan(0);
      expect(bIndex).toBeLessThan(mergeIndex);
    });
  });

  describe('hasEvent', () => {
    it('should return true for existing events', () => {
      storage.addEvent({
        id: 'exists',
        type: EventType.INSERT,
        position: 0,
        content: 'x',
        parentVersion: new Set([]),
        timestamp: 100
      });

      expect(storage.hasEvent('exists')).toBe(true);
    });

    it('should return false for non-existent events', () => {
      expect(storage.hasEvent('does-not-exist')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle events with empty parent version', () => {
      const orphan: Event = {
        id: 'orphan',
        type: EventType.INSERT,
        position: 0,
        content: 'o',
        parentVersion: new Set([]),
        timestamp: 100
      };

      storage.addEvent(orphan);
      expect(storage.getEvent('orphan')).toBeDefined();
    });

    it('should handle events with non-existent parents', () => {
      const orphan: Event = {
        id: 'orphan',
        type: EventType.INSERT,
        position: 0,
        content: 'o',
        parentVersion: new Set(['non-existent-1', 'non-existent-2']),
        timestamp: 100
      };

      expect(() => storage.addEvent(orphan)).not.toThrow();
      expect(storage.hasEvent('orphan')).toBe(true);
    });

    it('should handle circular dependencies gracefully', () => {
      // Note: In practice, this shouldn't happen, but we should handle it
      const e1: Event = {
        id: 'e1',
        type: EventType.INSERT,
        position: 0,
        content: 'a',
        parentVersion: new Set(['e2']), // Circular!
        timestamp: 100
      };

      const e2: Event = {
        id: 'e2',
        type: EventType.INSERT,
        position: 1,
        content: 'b',
        parentVersion: new Set(['e1']), // Circular!
        timestamp: 200
      };

      storage.addEvent(e1);
      storage.addEvent(e2);

      expect(() => storage.getEventsInCausalOrder()).not.toThrow();
    });

    it('should handle large timestamps', () => {
      const event: Event = {
        id: 'large-timestamp',
        type: EventType.INSERT,
        position: 0,
        content: 'x',
        parentVersion: new Set([]),
        timestamp: Number.MAX_SAFE_INTEGER
      };

      storage.addEvent(event);
      const retrieved = storage.getEvent('large-timestamp');
      expect(retrieved?.timestamp).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('performance', () => {
    it('should handle large number of events efficiently', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        storage.addEvent({
          id: `event${i}`,
          type: i % 3 === 0 ? 'delete' : 'insert',
          position: i % 10,
          content: i % 3 !== 0 ? String(i) : undefined,
          parentVersion: i === 0 ? [] : [`event${Math.max(0, i - 1)}`],
          timestamp: i
        });
      }

      const endTime = performance.now();
      
      expect(storage.getAllEvents()).toHaveLength(1000);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in less than 1 second
    });

    it('should sort large event sets efficiently', () => {
      // Add events in reverse order
      for (let i = 999; i >= 0; i--) {
        storage.addEvent({
          id: `event${i}`,
          type: EventType.INSERT,
          position: i,
          content: String(i),
          parentVersion: i === 0 ? [] : [`event${i - 1}`],
          timestamp: i
        });
      }

      const startTime = performance.now();
      const ordered = storage.getEventsInCausalOrder();
      const endTime = performance.now();
      
      expect(ordered).toHaveLength(1000);
      expect(ordered[0].id).toBe('event0');
      expect(ordered[999].id).toBe('event999');
      expect(endTime - startTime).toBeLessThan(500);
    });
  });
});
