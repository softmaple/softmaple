import { describe, it, expect, beforeEach } from 'vitest';
import { EgWalker } from '../eg-walker';
import type { Event } from '../types';

describe('EgWalker', () => {
  let egWalker: EgWalker;

  beforeEach(() => {
    egWalker = new EgWalker();
  });

  describe('Basic insert operations', () => {
    it('should handle single insert', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: [],
        timestamp: Date.now()
      });

      expect(egWalker.getDocument()).toBe('a');
    });

    it('should handle multiple sequential inserts', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: [],
        timestamp: 100
      });

      egWalker.applyEvent({
        id: 'e2',
        type: 'insert',
        position: 1,
        content: 'b',
        parentVersion: ['e1'],
        timestamp: 200
      });

      egWalker.applyEvent({
        id: 'e3',
        type: 'insert',
        position: 2,
        content: 'c',
        parentVersion: ['e2'],
        timestamp: 300
      });

      expect(egWalker.getDocument()).toBe('abc');
    });

    it('should handle insert at beginning', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'b',
        parentVersion: [],
        timestamp: 100
      });

      egWalker.applyEvent({
        id: 'e2',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: ['e1'],
        timestamp: 200
      });

      expect(egWalker.getDocument()).toBe('ab');
    });

    it('should handle insert in middle', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: [],
        timestamp: 100
      });

      egWalker.applyEvent({
        id: 'e2',
        type: 'insert',
        position: 1,
        content: 'c',
        parentVersion: ['e1'],
        timestamp: 200
      });

      egWalker.applyEvent({
        id: 'e3',
        type: 'insert',
        position: 1,
        content: 'b',
        parentVersion: ['e2'],
        timestamp: 300
      });

      expect(egWalker.getDocument()).toBe('abc');
    });
  });

  describe('Delete operations', () => {
    it('should handle delete operation', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'abc',
        parentVersion: [],
        timestamp: 100
      });

      egWalker.applyEvent({
        id: 'e2',
        type: 'delete',
        position: 1,
        parentVersion: ['e1'],
        timestamp: 200
      });

      expect(egWalker.getDocument()).toBe('ac');
    });

    it('should handle multiple deletes', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'abcde',
        parentVersion: [],
        timestamp: 100
      });

      egWalker.applyEvent({
        id: 'e2',
        type: 'delete',
        position: 1,
        parentVersion: ['e1'],
        timestamp: 200
      });

      egWalker.applyEvent({
        id: 'e3',
        type: 'delete',
        position: 2,
        parentVersion: ['e2'],
        timestamp: 300
      });

      expect(egWalker.getDocument()).toBe('ace');
    });

    it('should handle delete at beginning', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'abc',
        parentVersion: [],
        timestamp: 100
      });

      egWalker.applyEvent({
        id: 'e2',
        type: 'delete',
        position: 0,
        parentVersion: ['e1'],
        timestamp: 200
      });

      expect(egWalker.getDocument()).toBe('bc');
    });

    it('should handle delete at end', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'abc',
        parentVersion: [],
        timestamp: 100
      });

      egWalker.applyEvent({
        id: 'e2',
        type: 'delete',
        position: 2,
        parentVersion: ['e1'],
        timestamp: 200
      });

      expect(egWalker.getDocument()).toBe('ab');
    });

    it('should handle delete on empty document', () => {
      // Attempting to delete from empty document should not crash
      expect(() => {
        egWalker.applyEvent({
          id: 'e1',
          type: 'delete',
          position: 0,
          parentVersion: [],
          timestamp: 100
        });
      }).not.toThrow();

      expect(egWalker.getDocument()).toBe('');
    });
  });

  describe('Concurrent operations', () => {
    it('should handle concurrent inserts at same position', () => {
      // User A inserts 'a' at position 0
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: [],
        timestamp: 100
      });

      // User B inserts 'b' at position 0 (concurrent with e1)
      egWalker.applyEvent({
        id: 'e2',
        type: 'insert',
        position: 0,
        content: 'b',
        parentVersion: [],
        timestamp: 100
      });

      const doc = egWalker.getDocument();
      expect(doc.length).toBe(2);
      expect(doc).toMatch(/[ab]{2}/);
    });

    it('should handle interleaved operations', () => {
      // User A: insert 'a' at 0
      egWalker.applyEvent({
        id: 'a1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: [],
        timestamp: 100
      });

      // User B: insert 'b' at 0 (concurrent)
      egWalker.applyEvent({
        id: 'b1',
        type: 'insert',
        position: 0,
        content: 'b',
        parentVersion: [],
        timestamp: 100
      });

      // User A: insert 'c' at 1 (after their 'a')
      egWalker.applyEvent({
        id: 'a2',
        type: 'insert',
        position: 1,
        content: 'c',
        parentVersion: ['a1'],
        timestamp: 200
      });

      // User B: insert 'd' at 1 (after their 'b')
      egWalker.applyEvent({
        id: 'b2',
        type: 'insert',
        position: 1,
        content: 'd',
        parentVersion: ['b1'],
        timestamp: 200
      });

      const doc = egWalker.getDocument();
      expect(doc.length).toBe(4);
    });

   it('should handle concurrent deletes', () => {
     // Initial state: "abc"
     egWalker.applyEvent({
       id: 'init',
       type: 'insert',
       position: 0,
       content: 'abc',
       parentVersion: [],
       timestamp: 100
     });

     // User A deletes 'b' (position 1)
     egWalker.applyEvent({
       id: 'a1',
       type: 'delete',
       position: 1,
       parentVersion: ['init'],
       timestamp: 200
     });

     // User B also tries to delete 'b' (position 1) concurrently
     egWalker.applyEvent({
       id: 'b1',
       type: 'delete',
       position: 1,
       parentVersion: ['init'],
       timestamp: 200
     });

     // Should only delete once
     expect(egWalker.getDocument()).toBe('ac');
   });

    it('should handle delete-insert conflicts', () => {
      // Initial state: "ab"
      egWalker.applyEvent({
        id: 'init',
        type: 'insert',
        position: 0,
        content: 'ab',
        parentVersion: [],
        timestamp: 100
      });

      // User A deletes 'b' (position 1)
      egWalker.applyEvent({
        id: 'a1',
        type: 'delete',
        position: 1,
        parentVersion: ['init'],
        timestamp: 200
      });

      // User B inserts 'c' after 'b' (position 2) concurrently
      egWalker.applyEvent({
        id: 'b1',
        type: 'insert',
        position: 2,
        content: 'c',
        parentVersion: ['init'],
        timestamp: 200
      });

      const doc = egWalker.getDocument();
      expect(doc.length).toBe(2); // 'a' and 'c'
      expect(doc).toContain('a');
      expect(doc).toContain('c');
    });
  });

  describe('Complex scenarios', () => {
    it('should handle multi-character content', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'hello',
        parentVersion: [],
        timestamp: 100
      });

      egWalker.applyEvent({
        id: 'e2',
        type: 'insert',
        position: 5,
        content: ' world',
        parentVersion: ['e1'],
        timestamp: 200
      });

      expect(egWalker.getDocument()).toBe('hello world');
    });

    it('should handle mixed insert and delete sequence', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'test',
        parentVersion: [],
        timestamp: 100
      });

      egWalker.applyEvent({
        id: 'e2',
        type: 'delete',
        position: 2,
        parentVersion: ['e1'],
        timestamp: 200
      });

      egWalker.applyEvent({
        id: 'e3',
        type: 'insert',
        position: 2,
        content: 'x',
        parentVersion: ['e2'],
        timestamp: 300
      });

      expect(egWalker.getDocument()).toBe('text');
    });

    it('should handle diamond merge pattern', () => {
      // Initial document
      egWalker.applyEvent({
        id: 'root',
        type: 'insert',
        position: 0,
        content: 'base',
        parentVersion: [],
        timestamp: 100
      });

      // Branch A: insert at beginning
      egWalker.applyEvent({
        id: 'a1',
        type: 'insert',
        position: 0,
        content: '[A]',
        parentVersion: ['root'],
        timestamp: 200
      });

      // Branch B: insert at end
      egWalker.applyEvent({
        id: 'b1',
        type: 'insert',
        position: 4,
        content: '[B]',
        parentVersion: ['root'],
        timestamp: 200
      });

      // Merge: operation that depends on both branches
      egWalker.applyEvent({
        id: 'merge',
        type: 'insert',
        position: 5,
        content: '[M]',
        parentVersion: ['a1', 'b1'],
        timestamp: 300
      });

      const doc = egWalker.getDocument();
      expect(doc).toContain('[A]');
      expect(doc).toContain('[B]');
      expect(doc).toContain('[M]');
      expect(doc).toContain('base');
    });

    it('should handle out-of-order event application', () => {
      const events: Event[] = [
        {
          id: 'e3',
          type: 'insert',
          position: 2,
          content: 'c',
          parentVersion: ['e2'],
          timestamp: 300
        },
        {
          id: 'e1',
          type: 'insert',
          position: 0,
          content: 'a',
          parentVersion: [],
          timestamp: 100
        },
        {
          id: 'e2',
          type: 'insert',
          position: 1,
          content: 'b',
          parentVersion: ['e1'],
          timestamp: 200
        }
      ];

      events.forEach(e => egWalker.applyEvent(e));
      expect(egWalker.getDocument()).toBe('abc');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty content insert', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: '',
        parentVersion: [],
        timestamp: 100
      });

      expect(egWalker.getDocument()).toBe('');
    });

    it('should handle position beyond document length', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'ab',
        parentVersion: [],
        timestamp: 100
      });

      // Try to insert at position 10 (beyond document)
      egWalker.applyEvent({
        id: 'e2',
        type: 'insert',
        position: 10,
        content: 'c',
        parentVersion: ['e1'],
        timestamp: 200
      });

      // Should append at end
      expect(egWalker.getDocument()).toBe('abc');
    });

    it('should handle delete beyond document length', () => {
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'ab',
        parentVersion: [],
        timestamp: 100
      });

      // Try to delete at position 10
      expect(() => {
        egWalker.applyEvent({
          id: 'e2',
          type: 'delete',
          position: 10,
          parentVersion: ['e1'],
          timestamp: 200
        });
      }).not.toThrow();

      // Document should remain unchanged
      expect(egWalker.getDocument()).toBe('ab');
    });

    it('should handle special characters', () => {
      const specialContent = '\n\t\r🔥💯\\\"\'';
      
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: specialContent,
        parentVersion: [],
        timestamp: 100
      });

      expect(egWalker.getDocument()).toBe(specialContent);
    });

    it('should handle very long content', () => {
      const longContent = 'x'.repeat(10000);
      
      egWalker.applyEvent({
        id: 'e1',
        type: 'insert',
        position: 0,
        content: longContent,
        parentVersion: [],
        timestamp: 100
      });

      expect(egWalker.getDocument()).toBe(longContent);
    });
  });

  describe('Performance', () => {
    it('should handle many sequential operations efficiently', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        egWalker.applyEvent({
          id: `e${i}`,
          type: 'insert',
          position: i,
          content: String(i % 10),
          parentVersion: i === 0 ? [] : [`e${i - 1}`],
          timestamp: i
        });
      }

      const endTime = performance.now();
      
      expect(egWalker.getDocument().length).toBe(1000);
      expect(endTime - startTime).toBeLessThan(2000); // Should complete in < 2 seconds
    });

    it('should handle many concurrent operations', () => {
      const startTime = performance.now();
      
      // 100 concurrent inserts at position 0
      for (let i = 0; i < 100; i++) {
        egWalker.applyEvent({
          id: `concurrent${i}`,
          type: 'insert',
          position: 0,
          content: String(i % 10),
          parentVersion: [],
          timestamp: 100
        });
      }

      const endTime = performance.now();
      
      expect(egWalker.getDocument().length).toBe(100);
      expect(endTime - startTime).toBeLessThan(1000);
    });
  });
});
