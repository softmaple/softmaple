/**
 * Functional refactor of EgWalker class
 * Using smaller, composable functions and immutable operations
 */

import { promises as fs } from "fs";
import {
  Event,
  EventId,
  EventType,
  Version,
  AugmentedCRDTItem,
} from "../../types";
import { CausalGraph } from "../../causal-graph";
import { CRDT, START_ID, END_ID } from "../../crdt";
import { EventStorage } from "../../event-storage";
import {
  addToVersion,
  diffVersions,
  areDependenciesSatisfied,
} from "../utils/version";
import {
  isDeletionEvent,
  isInsertionEvent,
  getEventContent,
  groupConsecutiveEvents,
  sortEventsByDependencies,
} from "../utils/event";
import {
  insertAt,
  deleteAt,
  emptyDocument,
  documentToString,
} from "../utils/document";

// ============ Types ============

interface EgWalkerState {
  readonly eventStorage: EventStorage;
  readonly crdt: CRDT;
  readonly currentVersion: Version;
  readonly document: readonly string[];
  readonly deletionMarkers: ReadonlySet<EventId>;
}

interface ProcessResult {
  readonly state: EgWalkerState;
  readonly success: boolean;
  readonly error?: Error;
}

// ============ State Transformers ============

const createInitialState = (): EgWalkerState => ({
  eventStorage: new EventStorage(),
  crdt: new CRDT(),
  currentVersion: new Set(),
  document: [],
  deletionMarkers: new Set(),
});

const updateState = (
  state: EgWalkerState,
  updates: Partial<EgWalkerState>,
): EgWalkerState => ({
  ...state,
  ...updates,
});

const updateDocument = (
  state: EgWalkerState,
  document: readonly string[],
): EgWalkerState => updateState(state, { document });

const updateVersion = (state: EgWalkerState, version: Version): EgWalkerState =>
  updateState(state, { currentVersion: version });

const addDeletionMarker = (
  state: EgWalkerState,
  eventId: EventId,
): EgWalkerState =>
  updateState(state, {
    deletionMarkers: new Set([...state.deletionMarkers, eventId]),
  });

// ============ Pure Event Processing Functions ============

const canApplyDirectly = (event: Event, currentVersion: Version): boolean => {
  // Can apply directly if all dependencies are satisfied
  // and it's a simple sequential operation
  if (!areDependenciesSatisfied(event.parentVersion, currentVersion)) {
    return false;
  }

  // Check if it's a simple sequential insert/delete
  const parentCount = event.parentVersion.size;
  return parentCount <= 1;
};

const applyInsertionPure = (
  document: readonly string[],
  position: number,
  content: string,
): string[] => insertAt(document, position, content);

const applyDeletionPure = (
  document: readonly string[],
  position: number,
): string[] => deleteAt(document, position);

const processDirectEvent = (
  state: EgWalkerState,
  event: Event,
): EgWalkerState => {
  if (!canApplyDirectly(event, state.currentVersion)) {
    return state;
  }

  const newDocument = isInsertionEvent(event)
    ? applyInsertionPure(state.document, event.position, getEventContent(event))
    : isDeletionEvent(event)
      ? applyDeletionPure(state.document, event.position)
      : state.document;

  const newVersion = addToVersion(state.currentVersion, event.id);

  return updateState(state, {
    document: newDocument,
    currentVersion: newVersion,
  });
};

// ============ CRDT Operations ============

const createCRDTItem = (
  event: Event,
  prepareState: number,
  crdt: CRDT,
  position: number,
): AugmentedCRDTItem => {
  const items = crdt.getItems();

  // Early return for edge cases
  if (!items || items.length === 0) {
    return {
      id: event.id,
      originLeft: START_ID,
      originRight: END_ID,
      content: getEventContent(event),
      everDeleted: false,
      prepareState,
    };
  }

  // Determine originLeft
  let originLeft = START_ID;
  if (position > 0 && position <= items.length) {
    const leftItem = items[position - 1];
    if (leftItem) {
      originLeft = leftItem.id;
    }
  }

  // Determine originRight
  let originRight = END_ID;
  if (position >= 0 && position < items.length) {
    const rightItem = items[position];
    if (rightItem) {
      originRight = rightItem.id;
    }
  }

  return {
    id: event.id,
    originLeft,
    originRight,
    content: getEventContent(event),
    everDeleted: false,
    prepareState,
  };
};

const integrateCRDTItem = (crdt: CRDT, item: AugmentedCRDTItem): void => {
  crdt.integrate(item);
};

const regenerateFromCRDT = (crdt: CRDT): string[] => {
  const items = crdt.getItems();
  const visibleItems = items.filter(
    (item) =>
      item &&
      item.id !== START_ID &&
      item.id !== END_ID &&
      item.prepareState === 1,
  );

  return visibleItems.map((item) => item!.content || "");
};

// ============ Version Management ============

const prepareVersion = (
  currentVersion: Version,
  targetVersion: Version,
  eventStorage: EventStorage,
): Event[] => {
  const { toAdd, toRemove } = diffVersions(currentVersion, targetVersion);
  const eventsToRetreat: Event[] = [];
  const eventsToAdvance: Event[] = [];

  // Collect events to retreat
  toRemove.forEach((eventId) => {
    const event = eventStorage.getEvent(eventId);
    if (event) eventsToRetreat.push(event);
  });

  // Collect events to advance
  toAdd.forEach((eventId) => {
    const event = eventStorage.getEvent(eventId);
    if (event) eventsToAdvance.push(event);
  });

  return [...eventsToRetreat, ...eventsToAdvance];
};

// ============ File I/O Operations ============

const saveToFile = async (
  state: EgWalkerState,
  filePath: string,
  finalDocument?: string,
): Promise<void> => {
  const documentStr = finalDocument || state.document.join("");
  const buffer = state.eventStorage.serialize(documentStr);
  await fs.writeFile(filePath, buffer);
};

const loadFromFile = async (filePath: string): Promise<EgWalkerState> => {
  try {
    const buffer = await fs.readFile(filePath);
    // Create a new EventStorage instance with deserialized data
    const tempStorage = new EventStorage();
    tempStorage.deserialize(new Uint8Array(buffer));

    // Regenerate document from events
    const events = tempStorage.getAllEvents();
    const sortedEvents = sortEventsByDependencies(events).filter(
      (e): e is Event => e !== undefined,
    );

    // Build state immutably from scratch
    const freshState = createInitialState();
    const finalState = sortedEvents.reduce(
      (currentState, event) => processDirectEvent(currentState, event),
      freshState,
    );

    // Update the event storage with all events
    return {
      ...finalState,
      eventStorage: tempStorage,
    };
  } catch (error) {
    throw new Error(
      `Failed to load from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

// ============ Batch Processing ============

const processBatch = (
  state: EgWalkerState,
  events: readonly Event[],
): EgWalkerState => {
  // Group consecutive events for efficient processing
  const groups = groupConsecutiveEvents(events);

  return groups.reduce((currentState, group) => {
    // Process each group as a batch
    if (group.length === 1) {
      const firstEvent = group[0];
      return firstEvent
        ? processDirectEvent(currentState, firstEvent)
        : currentState;
    }

    // For multiple events, try to apply them together
    const allInserts = group.every(isInsertionEvent);
    const allDeletes = group.every(isDeletionEvent);

    if (allInserts) {
      const content = group.map(getEventContent).join("");
      const firstEvent = group[0];
      if (!firstEvent) return currentState;

      const newDoc = insertAt(
        currentState.document,
        firstEvent.position,
        content,
      );
      const newVersion = group.reduce(
        (v, e) => addToVersion(v, e.id),
        currentState.currentVersion,
      );
      return updateState(currentState, {
        document: newDoc,
        currentVersion: newVersion,
      });
    }

    if (allDeletes) {
      // Apply deletes in reverse order to maintain positions
      const sortedDeletes = [...group].sort((a, b) => b.position - a.position);
      const newDoc = sortedDeletes.reduce(
        (doc, event) => deleteAt(doc, event.position),
        [...currentState.document],
      );
      const newVersion = group.reduce(
        (v, e) => addToVersion(v, e.id),
        currentState.currentVersion,
      );
      return updateState(currentState, {
        document: newDoc,
        currentVersion: newVersion,
      });
    }

    // Mixed operations - process individually
    return group.reduce(processDirectEvent, currentState);
  }, state);
};

// ============ Main Class (Thin Wrapper) ============

export class FunctionalEgWalker {
  private state: EgWalkerState;

  constructor() {
    this.state = createInitialState();
  }

  async saveToFile(filePath: string, finalDocument?: string): Promise<void> {
    await saveToFile(this.state, filePath, finalDocument);
  }

  async loadFromFile(filePath: string): Promise<void> {
    this.state = await loadFromFile(filePath);
  }

  applyEvent(event: Event): void {
    // Early return if event is null/undefined
    if (!event) return;

    this.state.eventStorage.addEvent(event);

    if (canApplyDirectly(event, this.state.currentVersion)) {
      this.state = processDirectEvent(this.state, event);
      // processDirectEvent already adds the event ID to the version
      return;
    }

    // Need to use CRDT for complex merging
    const position = isInsertionEvent(event) ? event.position : 0;
    const item = createCRDTItem(event, 1, this.state.crdt, position);
    integrateCRDTItem(this.state.crdt, item);
    const newDocument = regenerateFromCRDT(this.state.crdt);
    this.state = updateDocument(this.state, newDocument);

    // Update version only for the CRDT path
    this.state = updateVersion(
      this.state,
      addToVersion(this.state.currentVersion, event.id),
    );
  }

  applyBatch(events: Event[]): void {
    // Early return for empty batch
    if (!events || events.length === 0) return;

    // Split events into those that can apply directly and those that need CRDT
    const canApply = events.filter((e) =>
      canApplyDirectly(e, this.state.currentVersion),
    );
    const needCRDT = events.filter(
      (e) => !canApplyDirectly(e, this.state.currentVersion),
    );

    // Add all events to storage
    events.forEach((e) => this.state.eventStorage.addEvent(e));

    // Process the events that can apply directly in batch
    if (canApply.length > 0) {
      this.state = processBatch(this.state, canApply);
    }

    // Early return if no events need CRDT
    if (needCRDT.length === 0) return;

    // Process remaining events through CRDT path one by one
    needCRDT.forEach((event) => {
      const position = isInsertionEvent(event) ? event.position : 0;
      const item = createCRDTItem(event, 1, this.state.crdt, position);
      integrateCRDTItem(this.state.crdt, item);
      const newDocument = regenerateFromCRDT(this.state.crdt);
      this.state = updateDocument(this.state, newDocument);
      this.state = updateVersion(
        this.state,
        addToVersion(this.state.currentVersion, event.id),
      );
    });
  }

  getDocument(): string {
    return this.state.document.join("");
  }

  getVersion(): Version {
    return new Set(this.state.currentVersion);
  }

  getStatistics(): any {
    return this.state.eventStorage.getStorageStatistics();
  }
}

// ============ Export Factory Functions ============

export const createEgWalker = (): FunctionalEgWalker =>
  new FunctionalEgWalker();

export const createEgWalkerWithEvents = (
  events: Event[],
): FunctionalEgWalker => {
  const walker = new FunctionalEgWalker();
  walker.applyBatch(events);
  return walker;
};
