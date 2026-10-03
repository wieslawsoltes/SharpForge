# Managed pointers and value copies

T03 uses immutable typed values and owned location descriptors. Assignment copies
nested value fields while preserving the identities of managed references inside
them. Interior addresses retain their containing heap object; frame locations
remain valid while a context is parked and expire on final frame exit.

The contracts follow [ECMA-335, sixth edition](https://ecma-international.org/wp-content/uploads/ECMA-335_6th_edition_june_2012.pdf),
Partitions I and III. Native fixtures target .NET 10. Fixture definitions are not
qualification evidence: execution remains deferred until E01 is assembled.

| Surface | Implementation and boundaries |
| --- | --- |
| Managed addresses | Locals, arguments, statics, arrays, boxes and nested struct fields; VM ownership, readonly writes and live frame identity checked |
| Struct copies | `createValue`, `copyValue`, `storageValue`; immutable nested records prevent host alias leaks |
| Boxing | Exact type headers, copied payloads, `unbox` aliases and `unbox.any` copies; enum/underlying compatibility; Nullable boxes to null or T |
| Layout | Sequential and explicit metadata layout, packing, nested alignment and configured native ABI; `sizeof` uses byte layout |
| Stack allocation | Zeroed, frame-owned regions; `maxStackMemoryBytes` defaults to 1 MiB across live and parked frames |
| Span | Owned address plus length, checked indexer, aliasing slices, empty defaults, readonly views and array/stack constructors |
| Raw memory | Little-endian primitive arrays and stack regions; `cpblk`, `initblk`, `unaligned.`, scalar/struct indirect access and BitConverter/Unsafe.As adapters |
| Pinning | Pinned array locals create scoped strong handles; native conversion and pointer arithmetic retain the lease; clearing the local revokes derived addresses |
| GC | Interior addresses, spans, nested value fields, nullable values and parked frames retain their owners; instruction-level GC stress is configurable |
| Source IR | Typed storage/field adapters and rectangular/Span operations share runtime helpers with CIL |

Reference-containing memory cannot be exposed as raw bytes. Ref structs cannot be
boxed or stored in heap/static slots. Pointer arithmetic stays inside an owned
allocation; expired or foreign addresses fail. Source syntax support is provided
by the separate ref/rectangular/Span compiler adapters; runtime tests alone do not
claim general source struct, unsafe or fixed syntax support.

Heap writes use the shared write barrier. Frame regions, pin leases and pointer
descriptors participate in snapshot preflight; frame indices and layout caches
are derived state. T06 owns portable serialization and copy-on-write snapshots.

Prepared evidence inputs:

- `tests/fixtures/a05/managed-values`: copies, boxed structs, nested references.
- `tests/fixtures/a05/memory-leaves`: stackalloc initializers, Span slices, fixed
  arrays, GC, layout, bit reinterpretation, nullable and enum boxing.
- `tests/byref-gc-stress.test.js`: 1,000 CIL and 1,000 source seeded programs, plus a
  negative mutation that removes the interior-owner root.
- `examples/managed-memory`: source Span and rectangular-array example.

After the complete epic is assembled, run the focused tests and native fixture
runner, then the browser qualification harness against the same DLLs:

```sh
node --test tests/a05-03-managed-values.test.js tests/a05-frame-lifetimes.test.js tests/a05-nullable-layout.test.js tests/a05-stack-memory.test.js tests/a05-memory-boundaries.test.js tests/byref-gc-stress.test.js
node scripts/validate-a05-type-system.js --fixture tests/fixtures/a05/memory-leaves --output artifacts/a05-memory
node tests/a05-03-benchmark.js
```

Record the exact commit, runtime/SDK/browser versions, native and VM outputs,
latencies and managed allocations. Host heap growth is not an exact allocation
count. Rust/native-Wasm execution is a separate target and is not covered by these
JavaScript runtime fixtures.
