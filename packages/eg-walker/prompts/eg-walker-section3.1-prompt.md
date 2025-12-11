
# Claude Code Prompt — Implement Section 3.1 (Characteristics)

You are implementing the **Eg-walker collaborative editing algorithm**, specifically the logic described in **Section 3.1 — Characteristics** of the paper *Collaborative Text Editing with Eg-walker*.

Your task is to implement the invariants and behaviors required in this section.  
Follow the rules below strictly.

---

## Goal

Implement the core characteristics of Eg-walker:

1. **Strong list specification** – preserve the sequential semantics of text editing.  
2. **Maximally non-interleaving behavior** – concurrent insertions should group into blocks, not interleave character-by-character.  
3. **Minimal and temporary internal metadata** – internal CRDT state exists only during transformation and is discarded when no longer needed.  
4. **Index-based external API** – external operations are always based on numeric indices, never CRDT IDs.  
5. **No persistent CRDT tombstones or per-character IDs** – the algorithm must not store CRDT-heavy metadata on disk.  

You are not implementing the entire algorithm here—only the **fundamental invariants and constraints from Section 3.1**, ensuring that all subsequent code (retreat/advance/transform) operates under the correct assumptions.

---

## Required functional constraints

### 1. Strong list specification
- Insert and delete operations must behave exactly as if applied to a single ideal linearized text list.
- If two replicas apply the same event graph, they must produce identical text outputs.
- The order of visible characters must be deterministic and independent of network delivery order.

### 2. Maximally non-interleaving rule
When two users concurrently insert multi-character strings at the same position:

A valid non-interleaving result is:

```
HelloWorld
```
or

```
WorldHello
```

But never:

```
HWeolrllod
```

You must enforce this behavior via the internal CRDT ordering logic.

### 3. Internal CRDT state must be temporary
- Exists only for performing transformations.
- Must **not** be persisted or exposed through public APIs.
- Must maintain:
  - prepare-state  
  - effect-state  
  - stable ordering of concurrent insertions  

### 4. External API must stay index-based
Public APIs must accept only:

```
insert(index: number, text: string)
delete(index: number, length: number)
```

No CRDT identifiers should appear in public API signatures.

### 5. No persistent CRDT metadata
Only the following may be stored on disk:

- Plain text
- Event graph

No persistent per-character IDs, lamport timestamps, or tombstones.

---

## Coding rules

- Use small, pure, testable functions.
- Maintain strict separation of modules:
  - `core/` – algorithm orchestration  
  - `crdt/` – temporary internal CRDT ordering  
  - `graph/` – event graph logic  
- Avoid global state and side effects.
- Write code assuming future integration with retreat/advance/transform.

---

## Deliverables

When implementing Section 3.1, generate:

- Type definitions  
- Internal CRDT scaffolding  
- Invariants ensuring non-interleaving  
- Strong list specification helpers  
- Clear module boundaries  

Do **not** implement the full walker yet—only the foundations required by Section 3.1.

