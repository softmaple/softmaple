import { describe, it, expect, beforeEach } from 'vitest';
import { CRDT, START_ID, END_ID } from '../crdt';
import { AugmentedCRDTItem } from '../types';

type CRDTItem = AugmentedCRDTItem;

describe('CRDT', () => {
  let crdt: CRDT;

  beforeEach(() => {
    crdt = new CRDT();
  });

  describe('initialization', () => {
    it('should initialize with start and end sentinels', () => {
      const items = crdt.getItems();
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe(START_ID);
      expect(items[1].id).toBe(END_ID);
    });

    it('should have sentinels in correct prepare state', () => {
      const items = crdt.getItems();
      expect(items[0].prepareState).toBe(1); // START is inserted
      expect(items[1].prepareState).toBe(1); // END is inserted
    });
  });

  describe('integrate', () => {
    it('should insert item between start and end', () => {
      const item: CRDTItem = {
        id: 'item1',
        originLeft: START_ID,
        originRight: END_ID,
        content: 'a',
        everDeleted: false,
        prepareState: 1
      };

      crdt.integrate(item);
      const items = crdt.getItems();
      
      expect(items).toHaveLength(3);
      expect(items[1].id).toBe('item1');
      expect(items[1].content).toBe('a');
    });

    it('should handle concurrent insertions at same position', () => {
      const item1: CRDTItem = {
        id: 'item1',
        originLeft: START_ID,
        originRight: END_ID,
        content: 'a',
        everDeleted: false,
        prepareState: 1
      };

      const item2: CRDTItem = {
        id: 'item2',
        originLeft: START_ID,
        originRight: END_ID,
        content: 'b',
        everDeleted: false,
        prepareState: 1
      };

      crdt.integrate(item1);
      crdt.integrate(item2);

      const items = crdt.getItems();
      expect(items).toHaveLength(4);
      
      // Items should be ordered deterministically by ID
      const ids = items.map(i => i.id);
      expect(ids).toContain('item1');
      expect(ids).toContain('item2');
    });

    it('should insert after specific origin', () => {
      const item1: CRDTItem = {
        id: 'item1',
        originLeft: START_ID,
        originRight: END_ID,
        content: 'a',
        everDeleted: false,
        prepareState: 1
      };

      const item2: CRDTItem = {
        id: 'item2',
        originLeft: 'item1',
        originRight: END_ID,
        content: 'b',
        everDeleted: false,
        prepareState: 1
      };

      crdt.integrate(item1);
      crdt.integrate(item2);

      const items = crdt.getItems();
      const item1Index = items.findIndex(i => i.id === 'item1');
      const item2Index = items.findIndex(i => i.id === 'item2');
      
      expect(item2Index).toBe(item1Index + 1);
    });

    it('should handle complex origin configurations', () => {
      // Create a chain: START -> a -> b -> c -> END
      const itemA: CRDTItem = {
        id: 'a',
        originLeft: START_ID,
        originRight: END_ID,
        content: 'a',
        everDeleted: false,
        prepareState: 1
      };

      const itemB: CRDTItem = {
        id: 'b',
        originLeft: 'a',
        originRight: END_ID,
        content: 'b',
        everDeleted: false,
        prepareState: 1
      };

      const itemC: CRDTItem = {
        id: 'c',
        originLeft: 'b',
        originRight: END_ID,
        content: 'c',
        everDeleted: false,
        prepareState: 1
      };

      // Now insert 'd' between 'a' and 'c' (concurrent with 'b')
      const itemD: CRDTItem = {
        id: 'd',
        originLeft: 'a',
        originRight: 'c',
        content: 'd',
        everDeleted: false,
        prepareState: 1
      };

      crdt.integrate(itemA);
      crdt.integrate(itemB);
      crdt.integrate(itemC);
      crdt.integrate(itemD);

      const items = crdt.getItems();
      const contents = items.filter(i => i.content).map(i => i.content);
      
      // 'd' should be between 'a' and 'c'
      const aIndex = contents.indexOf('a');
      const dIndex = contents.indexOf('d');
      const cIndex = contents.indexOf('c');
      
      expect(aIndex).toBeLessThan(dIndex);
      expect(dIndex).toBeLessThan(cIndex);
    });
  });

  describe('findItemById', () => {
    it('should find existing items', () => {
      const item: CRDTItem = {
        id: 'test-id',
        originLeft: START_ID,
        originRight: END_ID,
        content: 'test',
        everDeleted: false,
        prepareState: 1
      };

      crdt.integrate(item);
      const found = crdt.findItemById('test-id');
      
      expect(found).toBeDefined();
      expect(found?.content).toBe('test');
    });

    it('should return undefined for non-existent items', () => {
      const found = crdt.findItemById('non-existent');
      expect(found).toBeUndefined();
    });

    it('should find sentinel items', () => {
      expect(crdt.findItemById(START_ID)).toBeDefined();
      expect(crdt.findItemById(END_ID)).toBeDefined();
    });
  });

  describe('getPositionAtPrepareState', () => {
    beforeEach(() => {
      // Set up items with different prepare states
      const items = [
        {
          id: 'item1',
          originLeft: START_ID,
          originRight: END_ID,
          content: 'a',
          everDeleted: false,
          prepareState: 1 // Inserted
        },
        {
          id: 'item2',
          originLeft: 'item1',
          originRight: END_ID,
          content: 'b',
          everDeleted: false,
          prepareState: 0 // Not yet inserted
        },
        {
          id: 'item3',
          originLeft: 'item2',
          originRight: END_ID,
          content: 'c',
          everDeleted: false,
          prepareState: 1 // Inserted
        },
        {
          id: 'item4',
          originLeft: 'item3',
          originRight: END_ID,
          content: 'd',
          everDeleted: false,
          prepareState: 2 // Deleted
        }
      ];

      items.forEach(item => crdt.integrate(item));
    });

    it('should count only inserted items', () => {
      // Only 'a' and 'c' are in INSERTED state (prepareState === 1)
      const pos0 = crdt.getPositionAtPrepareState(0);
      const pos1 = crdt.getPositionAtPrepareState(1);
      const pos2 = crdt.getPositionAtPrepareState(2);
      
      expect(pos0).toBe(0); // Before 'a'
      expect(pos1).toBe(1); // After 'a'
      expect(pos2).toBe(2); // After 'c'
    });

    it('should handle position beyond available items', () => {
      const pos = crdt.getPositionAtPrepareState(10);
      expect(pos).toBeGreaterThanOrEqual(2); // At least after all inserted items
    });
  });

  describe('getPositionAtEffectState', () => {
    beforeEach(() => {
      const items = [
        {
          id: 'item1',
          originLeft: START_ID,
          originRight: END_ID,
          content: 'a',
          everDeleted: false,
          prepareState: 1
        },
        {
          id: 'item2',
          originLeft: 'item1',
          originRight: END_ID,
          content: 'b',
          everDeleted: true, // Deleted
          prepareState: 2
        },
        {
          id: 'item3',
          originLeft: 'item2',
          originRight: END_ID,
          content: 'c',
          everDeleted: false,
          prepareState: 1
        }
      ];

      items.forEach(item => crdt.integrate(item));
    });

    it('should count only non-deleted items', () => {
      // Only 'a' and 'c' are not deleted
      const pos0 = crdt.getPositionAtEffectState(0);
      const pos1 = crdt.getPositionAtEffectState(1);
      const pos2 = crdt.getPositionAtEffectState(2);
      
      expect(pos0).toBe(0); // Before 'a'
      expect(pos1).toBe(1); // After 'a'
      expect(pos2).toBe(2); // After 'c'
    });
  });

  describe('edge cases', () => {
    it('should handle items with undefined content', () => {
      const item: CRDTItem = {
        id: 'no-content',
        originLeft: START_ID,
        originRight: END_ID,
        everDeleted: false,
        prepareState: 1
      };

      expect(() => crdt.integrate(item)).not.toThrow();
      const found = crdt.findItemById('no-content');
      expect(found?.content).toBeUndefined();
    });

    it('should handle duplicate IDs gracefully', () => {
      const item1: CRDTItem = {
        id: 'duplicate',
        originLeft: START_ID,
        originRight: END_ID,
        content: 'first',
        everDeleted: false,
        prepareState: 1
      };

      const item2: CRDTItem = {
        id: 'duplicate',
        originLeft: START_ID,
        originRight: END_ID,
        content: 'second',
        everDeleted: false,
        prepareState: 1
      };

      crdt.integrate(item1);
      crdt.integrate(item2);

      // Should only have one item with that ID
      const items = crdt.getItems();
      const duplicates = items.filter(i => i.id === 'duplicate');
      expect(duplicates.length).toBeLessThanOrEqual(1);
    });

    it('should handle missing origin references', () => {
      const item: CRDTItem = {
        id: 'orphan',
        originLeft: 'non-existent-left',
        originRight: 'non-existent-right',
        content: 'orphan',
        everDeleted: false,
        prepareState: 1
      };

      expect(() => crdt.integrate(item)).not.toThrow();
    });
  });

  describe('performance', () => {
    it('should handle large number of sequential insertions', () => {
      const startTime = performance.now();
      
      for (let i = 0; i < 1000; i++) {
        const item: CRDTItem = {
          id: `item${i}`,
          originLeft: i === 0 ? START_ID : `item${i - 1}`,
          originRight: END_ID,
          content: String(i),
          everDeleted: false,
          prepareState: 1
        };
        crdt.integrate(item);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;
      
      expect(crdt.getItems().length).toBe(1002); // 1000 items + 2 sentinels
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });

    it('should handle concurrent insertions efficiently', () => {
      const items: CRDTItem[] = [];
      
      // Create 100 concurrent insertions at the same position
      for (let i = 0; i < 100; i++) {
        items.push({
          id: `concurrent${i}`,
          originLeft: START_ID,
          originRight: END_ID,
          content: String(i),
          everDeleted: false,
          prepareState: 1
        });
      }

      const startTime = performance.now();
      items.forEach(item => crdt.integrate(item));
      const endTime = performance.now();
      
      expect(crdt.getItems().length).toBe(102); // 100 items + 2 sentinels
      expect(endTime - startTime).toBeLessThan(500);
    });
  });
});
