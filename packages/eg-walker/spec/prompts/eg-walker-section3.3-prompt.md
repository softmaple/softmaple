
# Claude Code Prompt — Section 3.3  
## Internal CRDT State (Temporary, Non-Persistent)

You are implementing **Section 3.3** of the Eg-walker algorithm.

Your responsibilities:

- Define the structure of **Records**
- Maintain temporary **prepare-state** and **effect-state**
- Support CRDT ordering (originLeft, originRight)
- Provide APIs for record state transitions
- Implement a B-tree-like indexable internal structure (scaffolding only)

### Required Record Shape

```ts
interface Record {
  id: EventID
  originLeft: EventID | null
  originRight: EventID | null
  prepareState: PrepareState // NotInsertedYet | Ins | Del(n)
  effectState: EffectState   // Ins | Del
}
```

### Required Internal APIs

```ts
insertRecord(record: Record): void
deleteRecord(record: Record): void
applyPrepare(event: Event): void
undoPrepare(event: Event): void
applyEffect(event: Event): void
```

### Constraints

- Never persist CRDT records.
- Must support O(log n) lookup and update.
- Must obey maximally-non-interleaving ordering.
- Prepare/effect transitions must be deterministic.

Begin by generating:
`walker-crdt/internal-state.ts` (type definitions + method signatures).
