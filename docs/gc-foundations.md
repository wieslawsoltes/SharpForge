# Managed identity and layout foundations

The A06 foundation batch introduces independently usable identity and layout
components. The existing `ManagedHeap` remains the active runtime heap until the
collector, storage, lifetime, diagnostics, and snapshot services are assembled.

## Stable identities

`HandleTable` accepts an owning record state with `records`, `generations`, `free`,
and `generationCounter` fields. `allocate(record)` publishes the record and returns
an immutable `{h, g}` identity. `get(identity)` validates both parts;
`tryGet(identity)` returns null for an absent or stale identity. Null dereference
raises `NullReferenceException`; a mismatched identity raises
`InvalidReferenceException`.

Generations advance per slot. Releasing a record makes its slot reusable until the
configured generation limit is reached, at which point that slot is permanently
retired. Other slots remain available. Allocation normally takes constant time;
retired entries left in a free list are removed at most once.

The owner restores its records and generation array before calling
`HandleTable.restore(snapshot)`. Restore preserves generation high-water marks
from discarded future states. An identity issued after the saved state cannot
alias a new allocation following restoration. Snapshot validation rejects invalid
limits, high-water marks, and retired indices before changing identity state.

## Managed layouts

`TypeDescriptors` consumes the runtime's immutable `MethodTable` objects. Its
`get(kind, methodTable)` method caches one descriptor per table and storage kind.
Each registry explicitly uses four-byte or eight-byte pointers, independent of
the JavaScript host architecture.

`valueSize(type, pointerSize)` computes primitive, enum, reference, pointer, and
inline value widths. `recordSize(descriptor, length)` includes object headers,
array length or UTF-16 terminator storage, minimum object size, and pointer
alignment. Lengths and final sizes outside the safe integer range are rejected.
These are logical managed bytes; they do not estimate JavaScript host memory.

`visitEdges(record, visitor)` scans reference-capable slots.
`visitEdgeRange(record, start, limit, visitor, result)` supports bounded scans and
can reuse the supplied result object. Its cursor is an edge ordinal, while the
visitor receives the original storage slot. Primitive-only arrays take constant
time without visiting their elements. Nested value fields that contain references
remain visible as inline carriers for the collector's value visitor.

The public additions are `HandleTable`, `TypeDescriptors`, `visitEdges`,
`visitEdgeRange`, `recordSize`, and `valueSize`. Fault, identity-normalization, and
exact allocation-accounting modules are internal prerequisites for later batches.

## Qualification

`tests/a06-identity-core.test.js` directly exercises the real handle table with a
small owned record state, including reuse, overflow retirement, malformed input,
snapshot rewind, and exact byte totals. `tests/a06-layout-core.test.js` uses the
production `MethodTableRegistry` for pointer widths, descriptor caching, nested
reference fields, primitive scan elision, and bounded cursors. These suites do not
stand in for collector or source/CIL runtime integration tests; those belong to
the later activation batch.
