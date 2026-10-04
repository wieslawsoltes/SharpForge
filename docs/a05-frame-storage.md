# Managed frame storage (SF-A05-T09)

The source and direct CIL engines reuse frame objects and their args, locals and
evaluation arrays. A method's metadata determines the logical capacities; CIL
uses its verified `maxStack`. JavaScript engines control physical Array backing
capacity, so logical slot counts are not measurements of host heap bytes.

`framePoolBytes` bounds cached storage (default: `maxStackBytes`, or 1 MiB).
`framePooling: false` disables reuse. Every retired slot and continuation is
cleared after its return/EH callback completes. Parked contexts keep their live
frames. Cancellation, stop and restore discard reusable storage; snapshots
contain execution values and never the pool or liveness plans.

Reset walks own enumerable fields without materializing an `Object.keys` array
for each returned frame. The five reusable arrays (`args`, `locals`, `stack`,
`caught`, `unwinds`) are truncated; other fields are cleared, including extension
and continuation fields first added after an earlier reuse. Inherited properties
are ignored. This removes the explicit reset keys-array allocation; total host
allocations and throughput still require the serial benchmark qualification.

The heap accepts either `rootProvider(visitor)` or a provider returning an
iterable. Both existing `vm.roots()` diagnostic iterators remain available.
Production scans visit only reference-capable slots and continuations, without
materializing float or small-Int64 wrappers. Ordinary local/argument liveness is
computed once per method by backward dataflow. Address-taken slots and methods
with exception handlers remain conservative. Dead reference slots are cleared,
so debugger inspection can report them unavailable after their final use.
`preciseRoots: false` selects the older iterable scan for differential measurement;
`preciseRootLiveness: false` keeps locals live while retaining the visitor adapter.

Verified CIL pushes use the admitted method capacity. `maxStackValues` no longer
limits verified method execution; `maxStackBytes` and `maxFrames` remain the
managed recursion controls. Malformed `maxStack`, overflow on any reachable path,
and overflowing exception-handler entry heights are verification errors.

| Capability | Source VM | Direct CIL | Independent native CLR |
| --- | --- | --- | --- |
| Bounded reusable frame storage | Implemented | Implemented | Host implementation; not this JS pool |
| Visitor roots with conservative EH/address aliases | Implemented | Implemented | Not applicable |
| Verified maxstack admission | Verified IR stack heights | ECMA-335 method header/handler heights | CLR supplies its own verifier |
| Browser JS execution | Same modules; qualification pending | Same modules; qualification pending | Not applicable |

Runnable example: `examples/pooled-frames.cs` prints `3240` three times. The
allocation and root benchmark uses 500 real managed recursive frames, reports
cold/warm median, p95 and p99, frame/array counters, retention after collection,
and the visitor/generator ratio:

```sh
node scripts/bench-a05-frames.js
node --test --test-concurrency=1 tests/a05-09-*.test.js
```

No benchmark or qualification results are asserted in this implementation
change. Root's serialized queue must record the commit, Node/browser versions,
exact commands and artifacts. The target is at least 3x faster root scans and no
warm per-call frame-array allocation; the benchmark reports whether it was met.
The JS implementation does not claim independent Rust/native/Wasm qualification.
