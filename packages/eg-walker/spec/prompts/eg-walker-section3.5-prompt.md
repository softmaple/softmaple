
# Claude Code Prompt — Section 3.5  
## State Clearing (Critical Versions)

Section 3.5 defines Eg-walker’s mechanism for clearing internal CRDT state.

### Required Behaviors

Implement detection of a **critical version**:

```ts
isCriticalVersion(v: Version): boolean
```

and the ability to clear CRDT state:

```ts
clearInternalState(v: Version): void
```

### After clearing:

- prepare-state resets
- effect-state kept as minimal placeholders
- no old CRDT metadata may remain
- algorithm must still support later partial replay

### Importance

This mechanism enables Eg-walker to avoid storing CRDT metadata long‑term.

Produce scaffolding for critical version logic.
