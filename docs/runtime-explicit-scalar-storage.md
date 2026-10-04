# Explicit-layout scalar storage

This increment of [T03.2 / #1365](https://github.com/wieslawsoltes/SharpForge/issues/1365)
extends the existing direct-CIL value-storage adapter to reference-free explicit
layouts. `FieldLayout` offsets now control storage aliasing, not only `sizeof`.
For example, writing a byte at offset 1 changes the second byte of an overlapping
Int32 field. A copied value has independent storage.

The admitted fields are Boolean, signed/unsigned integers, Char, Single, Double,
enums, configured-width native integers, and nested admitted sequential/explicit
structs. Layout and alignment reuse the existing `valueLayout` service. Its
metadata plans and the scalar admission cache share the existing code epoch;
committed metadata edits require execution-code invalidation. Assembly or
MethodTable-registry replacement also invalidates the plans.

An overlay is an immutable `{valueType, fields, explicitBytes}` record. Both arrays
are frozen, and `explicitBytes` contains little-endian byte values. Nested struct
views retain their own immutable byte slice, including padding. Field writes
copy the bytes, change the selected field, and rebuild all overlapping views.
Whole-value copies preserve bytes rather than re-encoding aliases. This retains
stored integer bits, signed zero, quiet-NaN payload bits, and padding across
copies. Writing a fresh sequential value into an overlay initializes its padding
to zero; raw pointer access to padding is outside this increment.

Existing `initobj`, `ldobj`, `stobj`, `cpobj`, field/address, array and boxing paths
use this adapter. Interior addresses continue to resolve their immutable field
path against live storage. Updating one nested field updates overlapping fields
in each enclosing explicit value. Ordinary same-VM snapshots can retain frozen
records safely; subsequent writes produce new records. The byte view is an
in-process carrier, not a portable snapshot format or a raw-memory API.

Each operation retains the 65,536 expanded-field limit. Byte-view materialization
is additionally bounded by `maxValueTypeBytes`, a positive safe integer at most
16 MiB. The default is the smaller of the heap byte limit and 1 MiB. This counts
the sum of materialized aggregate views in the operation, including nested views
and validation copies, rather than only the outer struct size. It is a host work
limit, not a managed heap accounting claim. A lowered limit applies on the next
copy/write even if its metadata is cached; exhaustion raises
`OutOfMemoryException` before destination mutation. Invalid host limits raise
`RangeError`. No throughput or memory benchmark has been run for this leaf.

Malformed byte arrays, inconsistent field views, foreign type identities and
missing byte storage reject through the existing managed storage boundary.
Missing/duplicate offsets and invalid layouts still use layout diagnostics.
Managed-reference, Decimal, Nullable, pointer, opaque framework, readonly and
byref-like overlays remain explicitly unsupported. Valid CLR reference/reference
overlaps and invalid mixed reference/nonreference overlap handling still need
their separate reference-slot/GC implementation; these are not declared invalid
merely because this leaf omits them. Generic explicit-layout types remain
invalid under the existing CLI layout contract. Source struct lowering, raw
memory, portable snapshots and the full #1365/#1366 acceptance stay open.

`tests/a05-explicit-scalar-storage.test.js` authors independent CIL and host
storage cases for aliasing, partial offsets, native widths, floating bits,
nested copies, boxes/arrays, snapshot replay, malformed carriers, lifetime and
resource boundaries. The old blanket explicit-layout rejection in the sequential
storage suite is replaced by these positive and precise rejection cases.
Tests, native qualification, builds and checks are deferred to the root's serial
queue; no pass or performance claim is made here.
