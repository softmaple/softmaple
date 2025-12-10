# Eg-walker Algorithm Performance Optimizations

## Optimizations Applied

### 1. Version Diff Caching
- **Before**: O(n²) for each diff operation where n is the version size
- **After**: O(1) for cached lookups, O(n²) only on cache miss
- **Cache size**: 100 most recent diffs (LRU eviction)

### 2. Deletion Marker Set
- **Before**: O(m) scan through all CRDT items for each deletion check
- **After**: O(1) set lookup for quick deletion check
- **Memory trade-off**: Additional O(d) space where d is number of deletions

### 3. Batch Item Creation for Multi-character Inserts
- **Before**: Individual integration for each character
- **After**: Create all items first, then batch integrate
- **Benefit**: Better memory locality and reduced function call overhead

## Algorithm Complexity Analysis

### Time Complexity

#### Apply Event: O(m + k)
- m: number of CRDT items
- k: length of content (for inserts)
- Prepare phase: O(m) with caching, O(n²) without
- Execute phase: O(m) for delete, O(k*m) for insert

#### Generate Document: O(n * m)
- n: number of events
- m: average CRDT items per event
- With optimizations: Reduced by constant factors

### Space Complexity

#### Base Space: O(n + m)
- n: number of events stored
- m: total CRDT items

#### Additional with Optimizations: O(c + d)
- c: cache entries (bounded at 100)
- d: deletion markers

## Recommendations for Further Optimization

1. **Index-based CRDT lookups**: Replace linear scans with indexed structures
2. **Incremental document generation**: Update document incrementally instead of regenerating
3. **Parallel processing**: Process independent events in parallel
4. **Memory pooling**: Reuse CRDT item objects to reduce GC pressure
5. **Compressed version representations**: Use bit vectors for version sets
