import { describe, it, expect, beforeEach } from 'vitest';
import { CausalGraph } from '../causal-graph';
import type { Event } from '../types';

describe('CausalGraph', () => {
  let graph: CausalGraph;

  beforeEach(() => {
    graph = new CausalGraph();
  });

  describe('addEvent', () => {
    it('should add a single event', () => {
      const event: Event = {
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: [],
        timestamp: Date.now()
      };

      graph.addEvent(event);
      expect(graph.hasEvent('e1')).toBe(true);
    });

    it('should track parent-child relationships', () => {
      const parent: Event = {
        id: 'parent',
        type: 'insert',
        position: 0,
        content: 'p',
        parentVersion: [],
        timestamp: Date.now()
      };

      const child: Event = {
        id: 'child',
        type: 'insert',
        position: 1,
        content: 'c',
        parentVersion: ['parent'],
        timestamp: Date.now() + 1
      };

      graph.addEvent(parent);
      graph.addEvent(child);

      const children = graph.getChildren('parent');
      expect(children).toContain('child');
    });

    it('should handle multiple parents (merge)', () => {
      const parent1: Event = {
        id: 'p1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: [],
        timestamp: 100
      };

      const parent2: Event = {
        id: 'p2',
        type: 'insert',
        position: 0,
        content: 'b',
        parentVersion: [],
        timestamp: 200
      };

      const merge: Event = {
        id: 'merge',
        type: 'insert',
        position: 1,
        content: 'm',
        parentVersion: ['p1', 'p2'],
        timestamp: 300
      };

      graph.addEvent(parent1);
      graph.addEvent(parent2);
      graph.addEvent(merge);

      expect(graph.getChildren('p1')).toContain('merge');
      expect(graph.getChildren('p2')).toContain('merge');
    });
  });

  describe('happensBefore', () => {
    it('should return true for parent-child relationship', () => {
      const parent: Event = {
        id: 'parent',
        type: 'insert',
        position: 0,
        content: 'p',
        parentVersion: [],
        timestamp: 100
      };

      const child: Event = {
        id: 'child',
        type: 'insert',
        position: 1,
        content: 'c',
        parentVersion: ['parent'],
        timestamp: 200
      };

      graph.addEvent(parent);
      graph.addEvent(child);

      expect(graph.happensBefore('parent', 'child')).toBe(true);
      expect(graph.happensBefore('child', 'parent')).toBe(false);
    });

    it('should handle transitive relationships', () => {
      const e1: Event = {
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: [],
        timestamp: 100
      };

      const e2: Event = {
        id: 'e2',
        type: 'insert',
        position: 1,
        content: 'b',
        parentVersion: ['e1'],
        timestamp: 200
      };

      const e3: Event = {
        id: 'e3',
        type: 'insert',
        position: 2,
        content: 'c',
        parentVersion: ['e2'],
        timestamp: 300
      };

      graph.addEvent(e1);
      graph.addEvent(e2);
      graph.addEvent(e3);

      expect(graph.happensBefore('e1', 'e3')).toBe(true);
      expect(graph.happensBefore('e3', 'e1')).toBe(false);
    });

    it('should return false for concurrent events', () => {
      const e1: Event = {
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: [],
        timestamp: 100
      };

      const e2: Event = {
        id: 'e2',
        type: 'insert',
        position: 0,
        content: 'b',
        parentVersion: [],
        timestamp: 200
      };

      graph.addEvent(e1);
      graph.addEvent(e2);

      expect(graph.happensBefore('e1', 'e2')).toBe(false);
      expect(graph.happensBefore('e2', 'e1')).toBe(false);
    });
  });

  describe('diff', () => {
    beforeEach(() => {
      // Create a diamond-shaped graph
      //     root
      //    /    \
      //   a      b
      //    \    /
      //     merge
      const root: Event = {
        id: 'root',
        type: 'insert',
        position: 0,
        content: 'r',
        parentVersion: [],
        timestamp: 100
      };

      const a: Event = {
        id: 'a',
        type: 'insert',
        position: 1,
        content: 'a',
        parentVersion: ['root'],
        timestamp: 200
      };

      const b: Event = {
        id: 'b',
        type: 'insert',
        position: 1,
        content: 'b',
        parentVersion: ['root'],
        timestamp: 300
      };

      const merge: Event = {
        id: 'merge',
        type: 'insert',
        position: 2,
        content: 'm',
        parentVersion: ['a', 'b'],
        timestamp: 400
      };

      graph.addEvent(root);
      graph.addEvent(a);
      graph.addEvent(b);
      graph.addEvent(merge);
    });

    it('should find differences between versions', () => {
      const [onlyInA, onlyInB] = graph.diff(['a'], ['b']);
      
      expect(onlyInA).toContain('a');
      expect(onlyInA).not.toContain('b');
      expect(onlyInB).toContain('b');
      expect(onlyInB).not.toContain('a');
      
      // Both should include root (common ancestor)
      expect(onlyInA).not.toContain('root');
      expect(onlyInB).not.toContain('root');
    });

    it('should handle empty versions', () => {
      const [onlyInEmpty, onlyInA] = graph.diff([], ['a']);
      
      expect(onlyInEmpty).toHaveLength(0);
      expect(onlyInA).toContain('a');
      expect(onlyInA).toContain('root');
    });

    it('should handle identical versions', () => {
      const [diff1, diff2] = graph.diff(['a'], ['a']);
      
      expect(diff1).toHaveLength(0);
      expect(diff2).toHaveLength(0);
    });

    it('should handle merged versions', () => {
      const [onlyInMerge, onlyInA] = graph.diff(['merge'], ['a']);
      
      expect(onlyInMerge).toContain('merge');
      expect(onlyInMerge).toContain('b');
      expect(onlyInMerge).not.toContain('a');
      expect(onlyInA).toHaveLength(0);
    });
  });

  describe('getTopologicalOrder', () => {
    it('should return empty array for empty graph', () => {
      const order = graph.getTopologicalOrder();
      expect(order).toHaveLength(0);
    });

    it('should order events respecting dependencies', () => {
      const e1: Event = {
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: [],
        timestamp: 100
      };

      const e2: Event = {
        id: 'e2',
        type: 'insert',
        position: 1,
        content: 'b',
        parentVersion: ['e1'],
        timestamp: 200
      };

      const e3: Event = {
        id: 'e3',
        type: 'insert',
        position: 2,
        content: 'c',
        parentVersion: ['e2'],
        timestamp: 300
      };

      graph.addEvent(e2);
      graph.addEvent(e3);
      graph.addEvent(e1);

      const order = graph.getTopologicalOrder();
      
      expect(order).toHaveLength(3);
      expect(order.indexOf('e1')).toBeLessThan(order.indexOf('e2'));
      expect(order.indexOf('e2')).toBeLessThan(order.indexOf('e3'));
    });

    it('should handle concurrent events deterministically', () => {
      const e1: Event = {
        id: 'e1',
        type: 'insert',
        position: 0,
        content: 'a',
        parentVersion: [],
        timestamp: 100
      };

      const e2: Event = {
        id: 'e2',
        type: 'insert',
        position: 0,
        content: 'b',
        parentVersion: [],
        timestamp: 100
      };

      graph.addEvent(e1);
      graph.addEvent(e2);

      const order1 = graph.getTopologicalOrder();
      const order2 = graph.getTopologicalOrder();
      
      expect(order1).toEqual(order2);
      expect(order1).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('should handle self-referential events gracefully', () => {
      const selfRef: Event = {
        id: 'self',
        type: 'insert',
        position: 0,
        content: 'x',
        parentVersion: ['self'], // Invalid but should handle
        timestamp: 100
      };

      expect(() => graph.addEvent(selfRef)).not.toThrow();
    });

    it('should handle missing parent references', () => {
      const orphan: Event = {
        id: 'orphan',
        type: 'insert',
        position: 0,
        content: 'o',
        parentVersion: ['non-existent'],
        timestamp: 100
      };

      expect(() => graph.addEvent(orphan)).not.toThrow();
      expect(graph.hasEvent('orphan')).toBe(true);
    });
  });
});
