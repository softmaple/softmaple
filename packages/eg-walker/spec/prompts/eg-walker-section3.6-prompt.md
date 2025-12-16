
# Claude Code Prompt — Section 3.6  
## Partial Replay (Efficient Reconstruction)

You are implementing **Section 3.6**.

When CRDT state is cleared, new events may refer to earlier events.  
You must support **partial replay** to rebuild only the minimal necessary state.

### Required APIs

```ts
computeReplayRange(from: Version, to: Version): EventID[]
replayEvents(events: EventID[]): void
```

### Constraints

- Replay must not scan entire event graph.
- Must replay only the minimal dependency set.
- Must reconstruct prepare-state deterministically.
- Must support placeholder reconstruction from cleared state.
- Must run in O(k log k), where k is the number of replayed events.

Implement scaffolding in `walker-crdt/internal-state.ts` and `walker-core/replay.ts`.
