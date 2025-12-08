Paper: https://arxiv.org/abs/2409.14252

code repo: https://github.com/josephg/eg-walker-reference

```code
let events: EventStorage // Assumed to contain all events
enum PREPARE_STATE {
NOT_YET_INSERTED = 0
INSERTED = 1
// Any state 2+ means the item has been concurrently deleted n-1 times.
}
// Each of these corresponds to a single inserted character.
type AugmentedCRDTItem {
// The fields from the CRDT that determines insertion order
id, originLeft, originRight,
// State at effect version. Either inserted or inserted-and-subsequently-deleted.
ever_deleted: bool,
// State at prepare version (affected by retreat / advance)
prepare_state: uint,
fn space_in_prepare_state(item: AugmentedCRDTItem) {
if item.prepare_state == INSERTED { return 1 } else { return 0 }
fn space_in_effect_state(item: AugmentedCRDTItem) {
if !item.ever_deleted { return 1 } else { return 0 }
}
}
}
// We have an efficient algorithm for this in our code. See diff() in causal-graph.ts.
fn diff(v1, v2) -> (only_in_v1, only_in_v2) {
// This function considers the transitive expansion of the versions v1 and v2.
// We return the set difference between the transitive expansions.
let all_events_v1 = {set of all events in v1 + all events which happened-before any event in v1}
let all_events_v2 = {set of all events in v2 + all events which happened-before any event in v2}
return (
set_subtract(all_events_v1 - all_events_v2),
set_subtract(all_events_v2 - all_events_v1)
)
}
```

```code
fn generateDocument(events) {
let cur_version = {} // Frontier version
// List of AugmentedCRDTItems. This could equally be an RGA tree or some other data structure.
let crdt = []
// Resulting document text
let resulting_doc = ""
// Some traversal obeying partial order relationship between events.
for e in events.iter_in_causal_order() {
// Step 1: Prepare
let (a, b) = diff(cur_version, e.parent_version)
for e in a {
// Retreat
let item = crdt.find_item_by_id(e.id)
item.prepare_state -= 1
}
for e in b {
// Advance
let item = crdt.find_item_by_id(e.id)
item.prepare_state += 1
}
// Step 2: Apply
if e.type== Insert {
// We find the insertion position in the crdt using the prepare_state variables.
let ins_pos = idx_of(crdt, e.pos, PREPARE_STATE)
// Then insert here using the underlying CRDT's rules.
let origin_left = prev_item(ins_pos).id or START
// Origin_right is the ID of the first item after ins_pos where prepare_state >= 1.
let origin_right = next_item(crdt, ins_pos, item => item.prepare_state >= INSERTED).id or END
// Use an existing CRDT to determine the order of concurrent insertions at the same position
crdt_integrate(crdt, {
id: e.id,
origin_left,
origin_right,
ever_deleted: false,
prepare_state: 1
})
let effect_pos = crdt[0..ins_pos].map(space_in_effect_state).sum()
resulting_doc.splice_in(effect_pos, e.contents)
} else {
// Delete
let idx = idx_of(crdt, e.pos, PREPARE_STATE)
// But this time skip any items which aren't in the inserted state.
while crdt[idx].prepare_state != INSERTED { idx += 1 }
// Mark as deleted.
crdt[idx].ever_deleted = true
crdt[idx].prepare_state += 1
let effect_pos = crdt[0..idx].map(space_in_effect_state).sum()
resulting_doc.delete_at(effect_pos)
}
cur_version = {e.id}
}
return resulting_doc
}
```
