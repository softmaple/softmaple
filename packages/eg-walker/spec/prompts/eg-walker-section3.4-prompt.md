
# Claude Code Prompt — Section 3.4  
## Index ↔ Record Mapping

You are implementing **Section 3.4** of Eg-walker.

Your job is to create utilities to convert:

1. **prepare-index → record**
2. **record → effect-index**

### Required APIs

```ts
indexToRecordPrepare(index: number): Record
recordToIndexEffect(record: Record): number
```

### Constraints

- Mapping must follow CRDT ordering rules.
- prepare-index includes deleted-but-visible records.
- effect-index excludes effect-deleted records.
- Must maintain maximally non‑interleaving ordering.
- Must work in O(log n).

Output mapping utilities inside `walker-crdt/internal-state.ts`.
