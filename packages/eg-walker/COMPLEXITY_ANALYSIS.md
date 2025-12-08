# Eg-walker Algorithm Complexity Analysis

## Overview
The eg-walker algorithm is a collaborative editing algorithm that maintains document consistency using CRDTs (Conflict-free Replicated Data Types) with a prepare-apply phase approach.

## Time Complexity Analysis

### Core Operations

#### 1. **Insert Operation** - `executeInsert()`
- **Character splitting**: O(m) where m = length of inserted content
- **Position finding** (`indexOfPosition`): O(n) where n = number of CRDT items
- **CRDT integration** per character:
  - Finding originLeft position: O(n)
  - RGA ordering comparison: O(k) where k = concurrent insertions at same position
  - Array splice: O(n)
- **Document update**: O(n) for position calculation + O(d) for splice where d = document length
- **Total**: O(m × n) for m-character insertion

#### 2. **Delete Operation** - `executeDelete()`
- **Finding item to delete**: O(n) scan through CRDT items
- **Creating deletion marker**: O(1)
- **CRDT integration**: O(n) same as insert
- **Document regeneration** (`regenerateDocument`): O(n)
- **Total**: O(n)

#### 3. **Prepare Phase** - `prepareForEvent()`
- **Version diff calculation**: O(v₁ + v₂) where v₁, v₂ = version sizes
  - Transitive expansion: O(e) where e = number of events in history
- **Retreat phase**: O(r × n) where r = events to retreat from
- **Advance phase**: O(a × n) where a = events to advance to
- **Total**: O(e + n × max(r, a))

#### 4. **Apply Event** - `applyEvent()`
- **Event storage**: O(1) amortized (HashMap insertion)
- **Causal graph update**: O(p) where p = parent version size
- **Prepare phase**: O(e + n × max(r, a))
- **Execute phase**: O(m × n) for insert, O(n) for delete
- **Version update**: O(p)
- **Total**: O(e + n × (m + max(r, a)))

#### 5. **Document Generation** - `generateDocument()`
- **Topological sort**: O(e + d) where d = dependencies
- **Process each event**: O(e × n)
- **Total**: O(e × n)

### Supporting Operations

#### CRDT Operations
- **integrate()**: O(n) - finding position and insertion
- **indexOfPosition()**: O(n) - linear scan
- **calculateEffectPosition()**: O(n) - linear scan
- **shouldComeAfter()**: O(1) - ID comparison

#### Causal Graph Operations
- **addEvent()**: O(p) where p = parent version size
- **happensBefore()**: O(e) worst case - DFS through graph
- **getTopologicalOrder()**: O(e + d) - standard topological sort
- **getTransitiveExpansion()**: O(e) - DFS/BFS through ancestors
- **diff()**: O(e) - two expansions + set operations

## Space Complexity Analysis

### Data Structures

1. **EventStorage**
   - Events map: O(e) where e = total events
   - Event order array: O(e)
   - Total: O(e)

2. **CausalGraph**
   - Events map: O(e)
   - Children map: O(e × c) where c = average children per event
   - Parents map: O(e × p) where p = average parents per event
   - Total: O(e × max(c, p))

3. **CRDT**
   - Items array: O(i) where i = total CRDT items (characters + deletions)
   - Items by ID map: O(i)
   - Total: O(i)

4. **EgWalker**
   - Current version: O(v) where v = version size
   - Document array: O(d) where d = document length
   - Total: O(v + d)

**Overall Space**: O(e × max(c, p) + i + d)

## Complexity Summary

### Typical Use Cases

1. **Single character insertion**: O(n)
2. **Multi-character insertion**: O(m × n)
3. **Single deletion**: O(n)
4. **Concurrent editing** (k users): O(k × n) for conflict resolution
5. **Document synchronization**: O(e × n)

### Bottlenecks

1. **Linear scans**: Most operations require O(n) scans through CRDT items
2. **Character-by-character processing**: Multi-character inserts are O(m × n)
3. **Version diff calculation**: Can be O(e) for large histories
4. **Document regeneration**: O(n) on every delete operation

### Optimization Opportunities

1. **Indexing**: Add position-to-item index to reduce O(n) scans to O(log n)
2. **Batch operations**: Process multi-character content as single units
3. **Incremental updates**: Avoid full document regeneration
4. **Version caching**: Cache transitive expansions for frequently used versions
5. **Sparse arrays**: Use tree structures for large documents

## Comparison with Other Algorithms

| Algorithm | Insert | Delete | Memory | Convergence |
|-----------|--------|--------|--------|-------------|
| Eg-walker | O(m×n) | O(n)   | O(e×p+i) | Guaranteed |
| OT        | O(n)   | O(n)   | O(n)   | Complex |
| Yjs       | O(log n)| O(log n)| O(n)  | Guaranteed |
| Automerge | O(log n)| O(log n)| O(n×h)| Guaranteed |

Where:
- n = document size
- m = operation size
- e = event history
- p = average parents
- h = history depth
- i = total items (including deleted)

## Conclusion

The eg-walker algorithm provides strong consistency guarantees with reasonable performance for small to medium documents. The main trade-offs are:

**Strengths**:
- Guaranteed convergence without transformation functions
- Simple conceptual model (prepare-apply phases)
- Handles arbitrary concurrent operations

**Weaknesses**:
- Linear time complexity for most operations
- Character-level granularity increases overhead
- Memory grows with operation history

For production use, consider implementing the suggested optimizations, particularly indexing and batch operations, to improve performance for larger documents.
