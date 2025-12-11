
# Claude Code Prompt — Implement Section 3.2 (Graph Walking)

You are implementing Section **3.2 — Walking the event graph** of the paper  
**_Collaborative Text Editing with Eg-walker_**.

Your task is to implement **graph traversal + version alignment mechanics** that Eg-walker requires.

This prompt defines all invariants, module responsibilities, and API expectations for Section 3.2.  
You must follow these requirements strictly.

---

# 🎯 Goal

Implement the **event‑graph walking mechanism**, including:

1. **Topological traversal of the event graph**
2. **Maintaining prepare-version and effect-version**
3. **Determining when to retreat or advance the internal CRDT state**
4. **Ensuring events are interpreted in the correct parent-defined state**
5. **Providing a foundation for transform (index → ID → index) in later sections**

You **are not** implementing transform or CRDT ordering here—only the *graph walking mechanics* required for correct replay.

---

# 📌 Core Requirements from Section 3.2

## 1. Topological traversal of the event graph

Implement a traversal that:

- Produces a valid **topological order**  
- Keeps events from the same branch grouped when possible  
- Minimizes alternation between branches  
- Works efficiently on DAGs with tens or hundreds of thousands of events  

The traversal must **never violate causality**:
```
If a → b then a must appear before b in the traversal.
```

You must generate the foundational API for:

```ts
graph.topologicalOrder(): EventID[]
```

And ensure it is deterministic.

---

## 2. Maintain **prepare-version** and **effect-version**

You must introduce internal variables:

```
prepareVersion: Version
effectVersion: Version
```

Where:

- `effectVersion` = all events processed so far  
- `prepareVersion` = parents(e) for the event currently being processed  

These versions must be represented using **frontiers** (sets of event IDs), not vector clocks.

Define clear helper functions:

```ts
getEffectVersion(): Version
getPrepareVersion(): Version
setPrepareVersion(v: Version): void
```

---

## 3. Retreat & Advance Triggers (but NOT their internals)

You do NOT implement how retreat/advance modifies CRDT state.  
You only implement **when** they must be called.

Retreating is required when:

```
prepareVersion ≠ parents(e)
and prepareVersion includes events not in parents(e)
```

Advancing is required when:

```
prepareVersion lacks events that parents(e) include
```

Define the calls:

```ts
internalState.retreat(event)
internalState.advance(event)
```

but leave their implementations as stubs.

---

## 4. Interpret each event in the correct parent-defined context

For each event `e` in topo order:

1. **Determine parents(e)**  
2. **Retreat until prepareVersion = parents(e)**  
3. Apply the operation to the internal CRDT prepare-state  
4. Add `e` to effectVersion  
5. Advance internal state until prepareVersion = effectVersion  

You must implement this control flow skeleton.

Pseudo-logic to produce:

```ts
for (const e of topoOrder) {
  retreatToParents(e.parents)
  internal.applyPrepare(e)
  effectVersion = effectVersion.add(e)
  advanceToEffectVersion()
}
```

---

## 5. Version Alignment Utilities

You must implement **helpers for version comparison**, including:

```ts
compareVersions(a: Version, b: Version): VersionDiff
```

Where `VersionDiff` indicates:

- events in A but not B
- events in B but not A  

This is required for determining retreat/advance triggers.

---

# 📦 Module Responsibilities

### `walker-graph/`
- event graph
- parent relationships
- topological sort

### `walker-core/`
- walking control loop  
- version alignment  
- preparation for transform  
- retreat/advance decision logic  

### `walker-crdt/`
- stubs for retreat() and advance()  
- (implementation deferred to later sections)

---

# 🧪 Testing Requirements

You must produce a structure that supports unit tests such as:

- Topological order is correct on:
  - linear chains
  - branching DAGs
  - heavily interleaved DAGs
- prepare-version always equals parents(e) before interpreting e
- advance/retreat are invoked in the right order
- version alignment is correct for:
  - sequential edits
  - simple concurrency
  - multi-user branched merges

Tests must not rely on CRDT internals.

---

# 📝 Deliverables

Claude must produce:

- TypeScript module skeletons for:
  - graph walking
  - version alignment logic
  - retreat/advance triggers
- Interfaces for:
  - Version
  - Walker
  - EventGraph traversal
  - Internal CRDT stub API
- Control-flow skeleton implementing Section 3.2
- Clear comments referencing "Section 3.2 — Graph Walking"

This is a **structural implementation**, not a full algorithm.

---

When you begin coding, first generate:

**`walker-core/walker.ts` skeleton with topological traversal + version alignment functions.**
