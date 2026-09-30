import type { EventId } from "../../types";
import type { AgentTable } from "./agent-table";

/** Numeric event IDs of a packed graph, by offset. */
export interface EventIdTieBreakerView {
  readonly agents: AgentTable;
  agentAt(offset: number): number;
  sequenceAt(offset: number): number;
  idAt(offset: number): EventId | undefined;
}

/**
 * Orders events by ID exactly like {@link compareEventIds}, without parsing.
 *
 * Topological orders break ties between events that are ready together.
 * Every canonical `replicaId:sequence` ID is already split into an agent
 * number and a sequence by the graph's ID index, so two canonical IDs compare
 * by replica name only when their agents differ and by sequence otherwise.
 * IDs that are not canonical sort after canonical ones, as raw strings.
 */
export class EventIdTieBreaker {
  constructor(private readonly view: EventIdTieBreakerView) {}

  /** Compare the events at two offsets; same sign as {@link compareEventIds}. */
  compare(left: number, right: number): number {
    if (left === right) {
      return 0;
    }
    const view = this.view;
    const leftAgent = view.agentAt(left);
    const rightAgent = view.agentAt(right);
    if (leftAgent >= 0 && rightAgent >= 0) {
      if (leftAgent !== rightAgent) {
        return view.agents.compare(leftAgent, rightAgent);
      }
      const leftSequence = view.sequenceAt(left);
      const rightSequence = view.sequenceAt(right);
      if (leftSequence === rightSequence) {
        return 0;
      }
      return leftSequence < rightSequence ? -1 : 1;
    }
    // Canonical IDs sort before custom IDs, which sort as raw strings.
    if (leftAgent >= 0) {
      return -1;
    }
    if (rightAgent >= 0) {
      return 1;
    }
    const leftId = view.idAt(left);
    const rightId = view.idAt(right);
    if (leftId === rightId) {
      return 0;
    }
    return leftId! < rightId! ? -1 : 1;
  }
}
