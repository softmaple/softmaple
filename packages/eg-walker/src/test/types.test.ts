import { describe, it, expect } from 'vitest';
import type { Event, Version, ItemId, Operation, PrepareState } from '../types';

describe('Types', () => {
  describe('Event', () => {
    it('should create a valid insert event', () => {
      const event: Event = {
        id: 'event1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: ['parent1'],
        timestamp: Date.now()
      };
      
      expect(event.type).toBe('insert');
      expect(event.content).toBe('a');
      expect(event.position).toBe(0);
    });

    it('should create a valid delete event', () => {
      const event: Event = {
        id: 'event2',
        type: 'delete',
        position: 1,
        parentVersion: ['parent1', 'parent2'],
        timestamp: Date.now()
      };
      
      expect(event.type).toBe('delete');
      expect(event.content).toBeUndefined();
      expect(event.parentVersion).toHaveLength(2);
    });
  });

  describe('Version', () => {
    it('should handle empty version', () => {
      const version: Version = [];
      expect(version).toHaveLength(0);
    });

    it('should handle single event version', () => {
      const version: Version = ['event1'];
      expect(version).toHaveLength(1);
      expect(version[0]).toBe('event1');
    });

    it('should handle multiple concurrent events', () => {
      const version: Version = ['event1', 'event2', 'event3'];
      expect(version).toHaveLength(3);
      expect(version).toContain('event2');
    });
  });

  describe('PrepareState', () => {
    it('should handle NOT_YET_INSERTED state', () => {
      const state: PrepareState = 0;
      expect(state).toBe(0);
    });

    it('should handle INSERTED state', () => {
      const state: PrepareState = 1;
      expect(state).toBe(1);
    });

    it('should handle multiple deletion states', () => {
      const state: PrepareState = 3; // Deleted twice
      expect(state).toBeGreaterThan(1);
      expect(state - 1).toBe(2); // Number of deletions
    });
  });

  describe('Operation', () => {
    it('should create insert operation with content', () => {
      const op: Operation = {
        type: 'insert',
        position: 5,
        content: 'hello'
      };
      
      expect(op.type).toBe('insert');
      expect(op.content).toBe('hello');
      expect(op.position).toBe(5);
    });

    it('should create delete operation without content', () => {
      const op: Operation = {
        type: 'delete',
        position: 3
      };
      
      expect(op.type).toBe('delete');
      expect(op.content).toBeUndefined();
      expect(op.position).toBe(3);
    });
  });
});
