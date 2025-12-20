/**
 * Section 3.2 — Walking the event graph
 * Main walker implementation that coordinates graph traversal with version alignment
 */

import type { EventId } from "../types";
import type { GraphEvent } from "../types";
import type { EventGraphWalker } from "../graph/topological-walker";
import type { InternalCRDTState } from "../crdt/retreat-advance-stubs";
import type { ClearableCRDTState } from "./critical-version";

/**
 * Type guard to check if CRDT state supports clearing operations
 */
function isClearable(state: unknown): state is ClearableCRDTState {
  // Guard against null/undefined and non-object values
  if (!state || typeof state !== "object") {
    return false;
  }

  // Now state is narrowed to object type
  const obj = state as object;

  return (
    "clearPrepareState" in obj &&
    "compactEffectState" in obj &&
    "clearCachedMetadata" in obj &&
    typeof (obj as ClearableCRDTState).clearPrepareState === "function" &&
    typeof (obj as ClearableCRDTState).compactEffectState === "function" &&
    typeof (obj as ClearableCRDTState).clearCachedMetadata === "function"
  );
}

import {
  StateClearer,
  DefaultCriticalVersionDetector,
} from "./critical-version";
import {
  FrontierVersion,
  VersionAlignmentManager,
} from "./version-alignment";
import { DefaultEventGraphWalker } from "../graph/topological-walker";
import { StubInternalCRDT } from "../crdt/retreat-advance-stubs";

/**
 * Configuration for the walker
 */
export interface WalkerConfig {
  /** Custom graph walker implementation */
  graphWalker?: EventGraphWalker;
  /** Custom internal CRDT implementation */
  internalCRDT?: InternalCRDTState;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result of walking the event graph
 */
export interface WalkResult {
  /** Final text after applying all events */
  finalText: string;
  /** Total events processed */
  eventsProcessed: number;
  /** Number of retreat operations */
  retreatCount: number;
  /** Number of advance operations */
  advanceCount: number;
}

/**
 * Main Eg-walker implementation for Section 3.2
 * Implements the core graph walking algorithm with version alignment
 */
export class EgWalker {
  private graphWalker: EventGraphWalker;
  private internalCRDT: InternalCRDTState;
  private versionManager: VersionAlignmentManager;
  private debug: boolean;
  private stateClearer: StateClearer;
  private appliedEvents: Set<EventId>;

  constructor(config: WalkerConfig = {}) {
    this.graphWalker = config.graphWalker || new DefaultEventGraphWalker();
    // Use ConcreteCRDTState for actual implementation
    // For testing, you can still pass StubInternalCRDT via config
    this.internalCRDT =
      config.internalCRDT ||
      (() => {
        try {
          // Try to use the concrete implementation
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { ConcreteCRDTState } = require("../crdt/retreat-advance");
          return new ConcreteCRDTState();
        } catch {
          // Fall back to stub if concrete not available
          return new StubInternalCRDT();
        }
      })();
    this.versionManager = new VersionAlignmentManager();
    this.debug = config.debug || false;
    this.appliedEvents = new Set();

    // Initialize state clearer with critical version detection
    const detector = new DefaultCriticalVersionDetector();
    this.stateClearer = new StateClearer(detector);
  }

  /**
   * Walk the event graph and apply all events
   * Implements the core algorithm from Section 3.2
   */
  walk(events: GraphEvent[]): WalkResult {
    // Reset state
    this.internalCRDT.reset();
    this.versionManager = new VersionAlignmentManager();
    this.appliedEvents = new Set();

    // Build the event graph
    for (const event of events) {
      this.graphWalker.addEvent(event);
    }

    // Get topological order
    const topoOrder = this.graphWalker.topologicalOrder();
    if (this.debug) {
      console.log("Topological order:", topoOrder);
    }

    let retreatCount = 0;
    let advanceCount = 0;

    // Process each event in topological order
    for (const eventId of topoOrder) {
      const event = events.find((e) => e.id === eventId);
      if (!event) continue;

      // Step 1: Determine parents(e)
      const parentVersion = new FrontierVersion(event.parentVersion);

      if (this.debug) {
        console.log(`\nProcessing event ${eventId}`);
        console.log("  Parent version:", Array.from(parentVersion.frontier));
        console.log(
          "  Current prepare:",
          this.versionManager.getPrepareVersion().getEvents(),
        );
      }

      // Step 2: Retreat until prepareVersion = parents(e)
      const retreatResult = this.retreatToVersion(parentVersion);
      retreatCount += retreatResult.retreatCount;

      // Step 3: Apply the operation to internal CRDT prepare-state
      this.appliedEvents = this.internalCRDT.applyPrepare(
        event,
        this.appliedEvents,
      );
      this.versionManager.setPrepareVersion(parentVersion.add(event.id));

      // Step 4: Add e to effectVersion
      this.versionManager.addToEffectVersion(event.id);

      // Step 5: Advance internal state until prepareVersion = effectVersion
      const advanceResult = this.advanceToEffectVersion();
      advanceCount += advanceResult.advanceCount;

      // Step 6: Check for critical version and clear state if needed
      const effectVersion = this.versionManager.getEffectVersion();
      if (effectVersion) {
        this.stateClearer.updateVersion(effectVersion.frontier);
      }
      // Try to clear state if we have an InternalCRDTState with clearing methods
      if (isClearable(this.internalCRDT)) {
        // No cast needed - isClearable already narrowed the type
        this.stateClearer.tryClearToCriticalVersion(this.internalCRDT);
      }
    }

    return {
      finalText: this.internalCRDT.getCurrentText(),
      eventsProcessed: topoOrder.length,
      retreatCount,
      advanceCount,
    };
  }

  /**
   * Retreat the internal CRDT until prepareVersion matches target
   */
  private retreatToVersion(targetVersion: FrontierVersion): {
    retreatCount: number;
  } {
    let retreatCount = 0;

    // Check if retreat is needed
    if (!this.versionManager.needsRetreat(targetVersion)) {
      // Check if advance is needed instead
      if (this.versionManager.needsAdvance(targetVersion)) {
        // We need to advance, not retreat
        const eventsToAdvance =
          this.versionManager.getEventsToAdvance(targetVersion);
        for (const eventId of eventsToAdvance) {
          if (this.debug) {
            console.log(`  Advancing event ${eventId}`);
          }
          this.appliedEvents = this.internalCRDT.advance(
            eventId,
            this.appliedEvents,
          );
          this.versionManager.setPrepareVersion(
            this.versionManager.getPrepareVersion().add(eventId),
          );
        }
      }
      return { retreatCount: 0 };
    }

    // Get events to retreat
    const eventsToRetreat =
      this.versionManager.getEventsToRetreat(targetVersion);

    // Retreat each event
    for (const eventId of eventsToRetreat) {
      if (this.debug) {
        console.log(`  Retreating event ${eventId}`);
      }
      this.appliedEvents = this.internalCRDT.retreat(
        eventId,
        this.appliedEvents,
      );
      retreatCount++;
    }

    // Update prepare version after retreat
    this.versionManager.setPrepareVersion(targetVersion);

    return { retreatCount };
  }

  /**
   * Advance the internal CRDT until prepareVersion matches effectVersion
   */
  private advanceToEffectVersion(): { advanceCount: number } {
    let advanceCount = 0;
    const effectVersion = this.versionManager.getEffectVersion();

    // Get events to advance
    const eventsToAdvance =
      this.versionManager.getEventsToAdvance(effectVersion);

    // Advance each event
    for (const eventId of eventsToAdvance) {
      if (this.debug) {
        console.log(`  Advancing to effect: ${eventId}`);
      }
      this.appliedEvents = this.internalCRDT.advance(
        eventId,
        this.appliedEvents,
      );
      advanceCount++;

      // Update prepare version
      this.versionManager.setPrepareVersion(
        this.versionManager.getPrepareVersion().add(eventId),
      );
    }

    return { advanceCount };
  }

  /**
   * Get the current prepare version (for testing/debugging)
   */
  getPrepareVersion(): FrontierVersion {
    return this.versionManager.getPrepareVersion();
  }

  /**
   * Get the current effect version (for testing/debugging)
   */
  getEffectVersion(): FrontierVersion {
    return this.versionManager.getEffectVersion();
  }
}
