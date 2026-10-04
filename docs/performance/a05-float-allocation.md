# A05 float allocation evidence

`bench/vm/float-allocation.js` separates three different observations:

- Every object created by the public bytecode `float()` factory is counted exactly.
  This includes carriers created by arithmetic, conversions and stores before a
  typed slot caches them. `NumericSlots.materializations` alone misses those sites.
- VM managed-heap and frame counters describe those particular stores. They do not
  count JavaScript float wrappers, closures, argument arrays or other host objects.
- V8 `--trace-gc-nvp` reports host collections and allocated-byte observations. The
  full trace is retained. Those bytes are not relabeled as an exact JS object count.

The isolated child registers a synchronous Node module load hook before importing
product packages. It adds a counter increment at the single reviewed `float()`
allocation expression. Changed or duplicate expressions fail closed. The report
records the original and instrumented source hashes and the allocation-site count.
The counter and load hook belong to the benchmark process; the shipped bytecode
factory has no instrumentation branch or process-wide counter. Node 22.15 or newer
is required for `module.registerHooks`; the qualification environment records the
actual Node and V8 versions.

The fixture adds exactly representable `0.25` to a double accumulator. One variant
uses double induction, so all loop data and comparisons use the typed float planes.
The mixed variant uses an Int32 induction variable with numeric specialization.
Both execute the normal CIL slice entry, real decoded instructions and actual
branches. The measured interval excludes construction, preparation, warmup and
the return boundary, where a float carrier is expected. There are no host callbacks
inside the loop. A generic float run is a positive control: its counter must detect
real carrier creation.

The CIL dispatch reentrancy state reuses a weakly held boolean entry rather than
inserting and deleting a WeakSet entry for every instruction. Nested dispatch and
fault cleanup retain the same observable active/inactive contract. Any host-allocation
benefit must be measured; the source edit itself is not evidence of a zero-allocation
loop.

Run the original #1395 per-iteration assessment serially on a clean committed
checkout, writing to a fresh path outside it:

```sh
SHARPFORGE_MAX_PARALLEL_RUNS=1 SHARPFORGE_TEST_CONCURRENCY=1 \
SHARPFORGE_MAX_OLD_SPACE_MB=512 \
node scripts/limited.js node bench/vm/float-allocation.js \
  --runner a05-linux-x64-node24 --warmup-slices 10 --warmup 100000 \
  --iterations 1000000 --out /tmp/a05-final-evidence/REVISION/float-warm10.json
```

The prescribed assessment warms each typed variant for 100,000 iterations in ten
real slices, then measures separate zero-iteration, 100,000-iteration and
1,000,000-iteration children. A seventh child is the generic positive control,
with 10,000 warmup and 10,000 measured iterations, also using ten warmup slices.
Each child has a 512 MiB heap and 120-second timeout. `--iterations` and `--warmup`
allow smaller development probes; every report records the actual counts. Reports
and all seven raw traces use exclusive creation and refuse to overwrite existing
evidence. Reduced counts do not qualify the prescribed per-iteration assessment.

`--warmup-slices N` partitions the same total warmup iterations across N real
`runSlice` calls, each ending at the same loop boundary. The default remains one
slice, preserving earlier driver behavior. The explicit ten-slice assessment above separates host
tier-up at repeatedly entered slice functions from the measured guest iterations;
it changes neither guest operations nor measured iteration counts. N is bounded
by 10,000 and the warmup count. The command, protocol and every child record retain
the partition explicitly. Results with different warmup partitions must not be
presented as identical protocols or silently substituted for earlier evidence.

The numeric stack retains its highest used backing extent within the verifier's
capacity. A separate logical length and presence bitmap preserve ordinary Array
length, holes, enumeration and host mutation behavior. Popping clears reference
and boundary-carrier planes without discarding the backing array. Descriptor or
prototype customization and capacity overflow materialize an ordinary array.
This eliminates repeated backing allocation while retaining bounded storage and
the snapshot/debugger contract; it is independently tested before qualification.

Issue #1395 explicitly permits a GC trace for the requirement of zero JavaScript
objects **per iteration**. The report's
`perIterationAllocationCriterion.acceptance` assesses that original clause for
the two specified warmed loops. It requires matching engine and instrumentation
identities, exact guest instruction counts and output, a detected generic
allocation control, zero measured float-carrier/managed/frame/frame-array
allocations, and no in-loop collections. Increasing work from 100,000 to 1,000,000
iterations must add no observed interval allocation bytes in either variant.
One additional byte makes the assessment inconclusive; a positive exact loop
counter is a miss. No byte tolerance or subtraction of fixed entry costs is used.

The trace totals include every in-loop collection's allocated bytes and the first
closing collection's pre-collection allocation interval. They do not substitute
post-GC retained heap size for allocations. Positive fixed marker and slice
entry/exit costs remain visible in the report. A per-iteration `met` result does
not claim zero objects during an entire run or enumerate every host allocation
site. `allHostObjectsPerRun` and the older
`assessment.totalJSObjectAcceptance` remain `unqualified` for those broader claims.

A completed driver run deliberately keeps top-level `acceptance: partial` and
exit status 2 because float differential evidence is separate. Neither that
status nor zero float carriers alone decides the original allocation clause.
Before interpreting a `met` clause, require top-level `status: measured`, no
errors, matching start/end commits, clean start/end worktrees, and all recorded
raw trace hashes. A failed or changed-worktree run cannot qualify a criterion.

The [criterion protocol and historical interpretation](../a05-float-allocation-criterion.md)
retain the earlier observations and their original statuses. Each new product
revision needs fresh measurement; this documentation update records no new run
or passing result. Passing float differential tests remain a separate condition
of #1395, and the allocation observation is limited to its recorded Node/V8
environment and warmed fixtures.

The module-hook protocol follows the official
[Node module customization documentation](https://nodejs.org/download/release/v24.19.0/docs/api/module.html#moduleregisterhooksoptions).
This Node CIL measurement does not qualify source execution, browser hosts, Rust or
native/Wasm allocators. Existing typed-float differential tests remain required for
IEEE boundaries, host edits, exception paths, snapshots and cancellation.
