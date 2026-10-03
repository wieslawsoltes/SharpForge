# Explicit struct storage

This is an E01 increment for [T03.2](https://github.com/wieslawsoltes/SharpForge/issues/1365)
and [T03.3](https://github.com/wieslawsoltes/SharpForge/issues/1366). It requires
the assembled value-copy, managed-address, GC and snapshot modules, not the
separate generic-sizeof follow-up.

Explicit structs now retain a frozen byte array (`explicitBytes`) alongside
their immutable field views. Writes through any field rebuild every alias.
Nested sequential value views retain bytes too, preserving padding and NaN
payloads through copies, arrays, boxes and raw reinterpretation. Managed
references remain actual managed references in the field views and never enter
the byte array. Identical reference slots alias, including nested struct slots;
the existing precise GC walker continues to trace those fields.

The layout plan rejects misaligned references, partially overlapping references
and reference/nonreference overlap with `TypeLoadException`. The distinction
matches the CLR's [explicit-layout loader checks](https://github.com/dotnet/runtime/blob/main/src/coreclr/vm/methodtablebuilder.cpp).
Numeric fields may overlap fully or partially. Native integer/reference widths
use the VM ABI. Per-value backing allocation is limited by `maxValueTypeBytes`
(default: the smaller of the heap byte budget and 1 MiB).

Frozen bytes participate in existing snapshot sharing and portable object-graph
encoding. Preflight reconstructs field views from the bytes and rejects missing,
mutable, oversized or inconsistent storage before restore changes live state.
No new VM fields or snapshot schema version are introduced.

Remaining valid CLR cases stay open under the two linked issues: explicit-layout
classes, raw-pointer fields, Decimal/Nullable/opaque framework payload overlays,
and byref-like value layouts. Unsupported struct payloads report
`NotSupportedException`; they are not classified as invalid CLR metadata.
These cases require additional storage adapters, and this increment does not
claim complete explicit-layout support. The source compiler's attribute/layout
lowering is also outside this increment.

Prepared regressions cover scalar/partial/nested/reference aliases, GC, value
copies, boxes, arrays, real field/byref/cpobj/initobj IL, padding/NaN bits,
snapshot replay and malformed snapshot rejection. The Roslyn differential
fixture is `tests/fixtures/a05/explicit-layout`. No tests, native tools, build or
checks were run here; qualification remains in the root's serial queue.
