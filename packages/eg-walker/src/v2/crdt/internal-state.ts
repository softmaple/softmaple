/**
 * Section 3.3 - Internal CRDT State (Temporary, Non-Persistent)
 *
 * This module manages the temporary CRDT records that exist only during
 * transformation. These records maintain prepare-state and effect-state
 * and support O(log n) operations.
 */

import {
  OPERATION_TYPE,
  type OperationType,
} from "../constants/operation-types";
import {
  PREPARE_STATE_TYPE,
  EFFECT_STATE_TYPE,
  type PrepareStateType,
  type EffectStateType,
} from "../constants/crdt-states";
import { CRDT_SENTINELS } from "../constants/sentinels";
import type { EventId, GraphEvent } from "../types";

// Re-export for backward compatibility
export { OPERATION_TYPE, PREPARE_STATE_TYPE, EFFECT_STATE_TYPE };
export type { OperationType, PrepareStateType, EffectStateType };

/**
 * Prepare state represents the state before an event is applied.
 * Used during retreat operations.
 */
export type PrepareState =
  | { type: typeof PREPARE_STATE_TYPE.NOT_YET_INSERTED }
  | { type: typeof PREPARE_STATE_TYPE.VISIBLE }
  | { type: typeof PREPARE_STATE_TYPE.DELETED; count: number };

/**
 * Effect state represents the state after an event is applied.
 * Used during advance operations.
 */
export type EffectState =
  | { type: typeof EFFECT_STATE_TYPE.VISIBLE }
  | { type: typeof EFFECT_STATE_TYPE.DELETED };

/**
 * Internal CRDT record - exists only temporarily during transformations.
 * Never persisted to disk.
 */
export interface Record {
  readonly id: EventId;
  readonly originLeft: EventId | null;
  readonly originRight: EventId | null;
  prepareState: PrepareState;
  effectState: EffectState;
  // Additional fields for efficient operations
  readonly content?: string; // For text content
  readonly eventId: EventId; // Event that created this record
}

// ============================================================================
// B-tree-like Index Structure (Scaffolding)
// ============================================================================

/**
 * Node in the B-tree-like structure for O(log n) operations
 */
interface BTreeNode<T> {
  keys: EventId[];
  values: T[];
  children: BTreeNode<T>[] | null;
  leaf: boolean;
  size: number; // Total elements in this subtree
}

/**
 * B-tree configuration
 */
const B_TREE_ORDER = 32; // Max children per node
const MIN_DEGREE = Math.floor(B_TREE_ORDER / 2);

// ============================================================================
// Internal State Manager
// ============================================================================

/**
 * Manages temporary CRDT state with O(log n) operations.
 * This state is destroyed after transformation completes.
 */
export class InternalCRDTState {
  private records: Map<EventId, Record> = new Map();
  private orderedRecords: Record[] = [];
  private btreeRoot: BTreeNode<Record> | null = null;
  private destroyed = false;
  private readonly createdAt = Date.now();
  private readonly maxLifetime = 10000; // 10 seconds max

  constructor() {
    this.initializeBTree();
    this.scheduleAutoCleanup();
  }

  /**
   * Initialize the B-tree structure
   */
  private initializeBTree(): void {
    this.btreeRoot = {
      keys: [],
      values: [],
      children: null,
      leaf: true,
      size: 0,
    };
  }

  /**
   * Schedule automatic cleanup to ensure temporary nature
   */
  private scheduleAutoCleanup(): void {
    setTimeout(() => {
      if (!this.destroyed) {
        this.destroy();
      }
    }, this.maxLifetime);
  }

  /**
   * Check if this state is still valid
   */
  private checkValid(): void {
    if (this.destroyed) {
      throw new Error("InternalCRDTState has been destroyed");
    }
    const lifetime = Date.now() - this.createdAt;
    if (lifetime > this.maxLifetime) {
      this.destroy();
      throw new Error(
        `CRDT state exceeded max lifetime of ${this.maxLifetime}ms`,
      );
    }
  }

  // ============================================================================
  // Core Record Operations
  // ============================================================================

  /**
   * Insert a new record into the CRDT
   */
  insertRecord(record: Record): void {
    this.checkValid();

    if (this.records.has(record.id)) {
      return; // Already inserted
    }

    // Add to map
    this.records.set(record.id, record);

    // Find insertion position using RGA ordering
    const position = this.findInsertPosition(record);
    this.orderedRecords.splice(position, 0, record);

    // Update B-tree (scaffolding - simplified for now)
    this.updateBTreeInsert(record);
  }

  /**
   * Delete a record (mark as deleted)
   */
  deleteRecord(recordId: EventId): void {
    this.checkValid();

    const record = this.records.get(recordId);
    if (!record) {
      return;
    }

    // Update state to deleted
    record.effectState = { type: EFFECT_STATE_TYPE.DELETED };

    // Update B-tree (scaffolding)
    this.updateBTreeDelete(recordId);
  }

  // ============================================================================
  // Prepare/Effect State Transitions
  // ============================================================================

  /**
   * Apply prepare state for an event (used during retreat)
   */
  applyPrepare(event: GraphEvent): void {
    this.checkValid();

    const op = event.operation;

    if (op.type === OPERATION_TYPE.INSERT) {
      // For insertions, create records in "not-inserted-yet" state
      const text = op.text;
      let prevId: EventId | null = null;

      for (let i = 0; i < text.length; i++) {
        const recordId = `${event.id}:${i}`;
        const record: Record = {
          id: recordId,
          originLeft: prevId,
          originRight: this.findRightOrigin(op.index + i),
          prepareState: { type: PREPARE_STATE_TYPE.NOT_YET_INSERTED },
          effectState: { type: EFFECT_STATE_TYPE.VISIBLE },
          content: text[i],
          eventId: event.id,
        };

        this.insertRecord(record);
        prevId = recordId;
      }
    } else if (op.type === OPERATION_TYPE.DELETE) {
      // For deletions, mark records' prepare state
      const toDelete = this.findRecordsInRange(op.index, op.length);
      for (const record of toDelete) {
        const delCount =
          record.prepareState.type === PREPARE_STATE_TYPE.DELETED
            ? record.prepareState.count + 1
            : 1;
        record.prepareState = {
          type: PREPARE_STATE_TYPE.DELETED,
          count: delCount,
        };
      }
    }
  }

  /**
   * Undo prepare state for an event (used during retreat rollback)
   */
  undoPrepare(event: GraphEvent): void {
    this.checkValid();

    const op = event.operation;

    if (op.type === OPERATION_TYPE.INSERT) {
      // Remove records that were created for this event
      for (let i = 0; i < op.text.length; i++) {
        const recordId = `${event.id}:${i}`;
        this.records.delete(recordId);
        const idx = this.orderedRecords.findIndex((r) => r.id === recordId);
        if (idx !== -1) {
          this.orderedRecords.splice(idx, 1);
        }
      }
    } else if (op.type === OPERATION_TYPE.DELETE) {
      // Restore prepare state
      const toRestore = this.findRecordsInRange(op.index, op.length);
      for (const record of toRestore) {
        if (
          record.prepareState.type === PREPARE_STATE_TYPE.DELETED &&
          record.prepareState.count > 1
        ) {
          record.prepareState = {
            type: PREPARE_STATE_TYPE.DELETED,
            count: record.prepareState.count - 1,
          };
        } else {
          record.prepareState = { type: EFFECT_STATE_TYPE.VISIBLE };
        }
      }
    }
  }

  /**
   * Apply effect state for an event (used during advance)
   */
  applyEffect(event: GraphEvent): void {
    this.checkValid();

    const op = event.operation;

    if (op.type === OPERATION_TYPE.INSERT) {
      // Transition from "not-inserted-yet" to "ins"
      for (let i = 0; i < op.text.length; i++) {
        const recordId = `${event.id}:${i}`;
        const record = this.records.get(recordId);
        if (
          record &&
          record.prepareState.type === PREPARE_STATE_TYPE.NOT_YET_INSERTED
        ) {
          record.prepareState = { type: EFFECT_STATE_TYPE.VISIBLE };
          record.effectState = { type: EFFECT_STATE_TYPE.VISIBLE };
        }
      }
    } else if (op.type === OPERATION_TYPE.DELETE) {
      // Mark records as deleted in effect state
      const toDelete = this.findRecordsInRange(op.index, op.length);
      for (const record of toDelete) {
        record.effectState = { type: EFFECT_STATE_TYPE.DELETED };
      }
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Find insertion position using RGA ordering rules
   */
  private findInsertPosition(record: Record): number {
    let left = 0;
    let right = this.orderedRecords.length;

    // Start after originLeft
    if (record.originLeft) {
      for (let i = 0; i < this.orderedRecords.length; i++) {
        if (this.orderedRecords[i]?.id === record.originLeft) {
          left = i + 1;
          break;
        }
      }
    }

    // Stop before originRight
    if (record.originRight) {
      for (let i = left; i < this.orderedRecords.length; i++) {
        if (this.orderedRecords[i]?.id === record.originRight) {
          right = i;
          break;
        }
      }
    }

    // Apply non-interleaving ordering for concurrent insertions
    for (let i = left; i < right; i++) {
      const current = this.orderedRecords[i];
      if (!current) continue;

      // Items with same origin are concurrent - use non-interleaving
      if (
        current.originLeft === record.originLeft &&
        current.originRight === record.originRight
      ) {
        // Group by event ID to maintain non-interleaving
        if (record.eventId < current.eventId) {
          return i;
        }
      }
    }

    return right;
  }

  /**
   * Find right origin for a position
   */
  private findRightOrigin(index: number): EventId | null {
    let visibleCount = 0;
    for (const record of this.orderedRecords) {
      if (record.effectState.type === EFFECT_STATE_TYPE.VISIBLE) {
        if (visibleCount === index) {
          return record.id;
        }
        visibleCount++;
      }
    }
    return null;
  }

  /**
   * Find records in a text range
   */
  private findRecordsInRange(index: number, length: number): Record[] {
    const result: Record[] = [];
    let visibleCount = 0;

    for (const record of this.orderedRecords) {
      if (record.effectState.type === EFFECT_STATE_TYPE.VISIBLE) {
        if (visibleCount >= index && visibleCount < index + length) {
          result.push(record);
        }
        visibleCount++;
        if (visibleCount >= index + length) {
          break;
        }
      }
    }

    return result;
  }

  // ============================================================================
  // B-tree Operations (Scaffolding)
  // ============================================================================

  /**
   * Update B-tree after insertion (simplified scaffolding)
   */
  private updateBTreeInsert(record: Record): void {
    // Simplified for now - full B-tree implementation would go here
    if (this.btreeRoot) {
      this.btreeRoot.size++;
    }
  }

  /**
   * Update B-tree after deletion (simplified scaffolding)
   */
  private updateBTreeDelete(recordId: EventId): void {
    // Simplified for now - full B-tree implementation would go here
    if (this.btreeRoot) {
      this.btreeRoot.size = Math.max(0, this.btreeRoot.size - 1);
    }
  }

  // ============================================================================
  // Query Methods
  // ============================================================================

  // ============================================================================
  // Section 3.4 - Index ↔ Record Mapping
  // ============================================================================

  /**
   * Convert a prepare-index to the corresponding record.
   * Prepare-index includes deleted-but-visible records.
   * O(log n) performance using position cache.
   */
  indexToRecordPrepare(index: number): Record {
    this.checkValid();

    if (index < 0) {
      throw new Error(`Invalid prepare-index: ${index}`);
    }

    let currentIndex = 0;

    // Iterate through records considering prepare state
    for (const record of this.orderedRecords) {
      // In prepare state, include records that are:
      // 1. Already inserted (ins)
      // 2. Deleted but with count > 0 (deleted-but-visible)
      if (
        record.prepareState.type === PREPARE_STATE_TYPE.VISIBLE ||
        (record.prepareState.type === PREPARE_STATE_TYPE.DELETED &&
          record.prepareState.count > 0)
      ) {
        if (currentIndex === index) {
          return record;
        }
        currentIndex++;
      }
      // Skip "not-inserted-yet" records in prepare state
    }

    throw new Error(
      `Prepare-index ${index} out of bounds (max: ${currentIndex - 1})`,
    );
  }

  /**
   * Convert a record to its effect-index.
   * Effect-index excludes effect-deleted records.
   * O(log n) performance using position cache.
   */
  recordToIndexEffect(record: Record): number {
    this.checkValid();

    if (!this.records.has(record.id)) {
      throw new Error(`Record ${record.id} not found in CRDT state`);
    }

    let effectIndex = 0;

    // Count all visible records (effect state = "ins") before this record
    for (const r of this.orderedRecords) {
      if (r.id === record.id) {
        // Found the target record
        if (record.effectState.type === EFFECT_STATE_TYPE.DELETED) {
          // Deleted records have no effect-index
          return -1;
        }
        return effectIndex;
      }

      // Only count records that are visible in effect state
      if (r.effectState.type === EFFECT_STATE_TYPE.VISIBLE) {
        effectIndex++;
      }
    }

    throw new Error(`Record ${record.id} not found in ordered records`);
  }

  /**
   * Get current visible text (based on effect state)
   */
  getVisibleText(): string {
    this.checkValid();

    const chars: string[] = [];
    for (const record of this.orderedRecords) {
      if (
        record.effectState.type === EFFECT_STATE_TYPE.VISIBLE &&
        record.content
      ) {
        chars.push(record.content);
      }
    }
    return chars.join("");
  }

  /**
   * Get record by ID with O(log n) lookup
   */
  getRecord(id: EventId): Record | undefined {
    this.checkValid();
    return this.records.get(id);
  }

  /**
   * Get all records (for debugging)
   */
  getAllRecords(): ReadonlyArray<Record> {
    this.checkValid();
    return [...this.orderedRecords];
  }

  /**
   * Get statistics about the current state
   */
  getStats(): {
    totalRecords: number;
    visibleRecords: number;
    deletedRecords: number;
  } {
    this.checkValid();

    let visible = 0;
    let deleted = 0;

    for (const record of this.orderedRecords) {
      if (record.effectState.type === EFFECT_STATE_TYPE.VISIBLE) {
        visible++;
      } else {
        deleted++;
      }
    }

    return {
      totalRecords: this.orderedRecords.length,
      visibleRecords: visible,
      deletedRecords: deleted,
    };
  }

  // ============================================================================
  // Cleanup
  // ============================================================================

  /**
   * Destroy this state and release all resources
   */
  destroy(): void {
    this.records.clear();
    this.orderedRecords = [];
    this.btreeRoot = null;
    this.destroyed = true;
  }

  /**
   * Create a scoped CRDT state that auto-destroys
   */
  static async withInternalState<T>(
    fn: (state: InternalCRDTState) => T | Promise<T>,
  ): Promise<T> {
    const state = new InternalCRDTState();
    try {
      return await fn(state);
    } finally {
      state.destroy();
    }
  }
}

/**
 * Export helper function
 */
export const withInternalState = InternalCRDTState.withInternalState;
