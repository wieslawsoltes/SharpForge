# CLI value layout and sizeof

This is a narrow prerequisite for [T03.3 / #1366](https://github.com/wieslawsoltes/SharpForge/issues/1366).
The direct-CIL interpreter now executes `sizeof` for supported closed TypeDef
and TypeSpec operands. It reuses the existing MethodTable identity and generic
call context; `!0` and `!!0` resolve in the executing frame. The verifier reuses
the existing generic variable/arity validation.

Supported layouts include primitive and native scalars, Decimal, enums, empty
values, sequential user structs with nested fields and packing, numeric
explicit-layout unions, declared ClassSize, and closed Nullable values.
Reference operands measure a reference slot using the VM's configured 32-bit
or 64-bit native ABI. No managed object is allocated to execute `sizeof`.

Plans retain size, alignment, reference presence and field offsets as immutable
metadata. ClassLayout and FieldLayout rows are indexed once per epoch, retaining
duplicate detection; TypeDef lookup reuses the runtime's existing metadata map.
Plans are cached per execution epoch and MethodTable, outside the VM
snapshot graph. Restore, committed code invalidation, assembly replacement and
stop discard the cache through existing execution-code lifecycle hooks.
Independent VMs and native widths cannot share a mutable plan.

Malformed generic operands, void, byrefs, raw pointers and typed references
reject through the managed execution profile. Missing explicit offsets,
recursive values, invalid packing and sizes outside the supported 1 through
2,147,483,647 byte range produce managed layout faults. Nesting is bounded to
128 active value types. A cold layout walks at most 65,536 fields, and its
metadata index accepts at most 262,144 combined layout rows. These fixed work
limits report `NotSupportedException` when exceeded. Cached reads do not
allocate traversal state. Opaque external layouts, nonempty auto-layout structs,
and explicit layouts containing managed references remain unsupported.
The latter require the reference-slot overlap checks in the later value
storage slice; this leaf does not invent a numeric answer for them.

This change computes physical layouts only. It does not enable user struct
copying, interior field addresses, boxing, raw-memory access, or GC tracing of
inline aggregates. Existing generic-call admission still rejects user structs
as generic call arguments and generic value-type owners until T03 storage is
available, except for the [bounded sizeof-only call shape](runtime-generic-sizeof-calls.md)
which requires layout metadata only. A closed struct TypeSpec may be a `sizeof` operand without storing
or passing a struct value. Source/reloaded engines retain existing primitive
`sizeof` support; no custom-struct source frontend parity is claimed.

Focused regressions exercise actual CIL instructions and calls, both ABI
widths, nested/packed/overlapping layouts, cache invalidation, snapshot replay,
malformed operands and unsupported boundaries. A Roslyn fixture is provided at
`tests/fixtures/a05/value-layout-sizeof`; its expected output is an unmeasured
qualification target, not a captured native result.

All 54 focused sizeof, native-width and generic-call/dispatch tests passed
serially with Node 24.21.0 at `d3dfff23`, using 512 MB and concurrency 1. Core
static/build evidence is recorded on the PR. Native tools were not run. Root
owns the serial validation queue. The focused command was:

```sh
node scripts/limited.js node --test --test-concurrency=1 tests/a05-value-layout-sizeof.test.js tests/a05-native-width-cil.test.js tests/a05-02-generic-calls.test.js tests/a05-02-generic-dispatch.test.js
```

Native/browser/platform qualification and the remainder of #1366 stay open.
