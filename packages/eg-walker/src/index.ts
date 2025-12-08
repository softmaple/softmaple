/**
 * @softmaple/eg-walker - Eg-walker algorithm for collaborative editing
 * 
 * Implementation of the Eg-walker algorithm for collaborative text editing
 */

// Core exports
export { EgWalker } from './eg-walker';
export { EventStorage } from './event-storage';
export { CausalGraph } from './causal-graph';
export { CRDT, START_ID, END_ID } from './crdt';

// Type exports
export {
  type Event,
  type EventId,
  type EventType,
  type Position,
  type Version,
  type PrepareState,
  type AugmentedCRDTItem,
  type spaceInPrepareState,
  type spaceInEffectState,
} from './types';

// Default export
export { EgWalker as default } from './eg-walker';
