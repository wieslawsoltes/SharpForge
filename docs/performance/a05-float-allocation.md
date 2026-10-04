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

Run serially on a clean integration commit:

```sh
node bench/vm/float-allocation.js --runner a05-linux-x64-node24 \
  --out artifacts/a05-float-allocation.json
```

The bounded protocol runs each typed variant with a warmed zero-iteration control,
100,000 iterations and 1,000,000 iterations, then a 10,000-iteration generic control.
Each child has a 512 MiB heap and 120-second timeout. `--iterations` and `--warmup`
allow smaller development probes; every report records the actual counts. Reports
and raw traces use exclusive creation and refuse to overwrite existing evidence.

`--warmup-slices N` partitions the same total warmup iterations across N real
`runSlice` calls, each ending at the same loop boundary. The default remains one
slice, preserving the original protocol. This optional diagnostic separates host
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

Zero float carriers may satisfy the narrow representation requirement. The broader
#1395 requirement of zero JS objects per iteration remains explicitly unqualified
until all remaining host allocation sites are accounted for. The current report
exits with status 2 for that partial qualification, even when the float counter is
zero and trace growth is absent. Positive byte growth or collection activity is
retained for follow-up, without subtracting noise or inventing a pass threshold.

The module-hook protocol follows the official
[Node module customization documentation](https://nodejs.org/download/release/v24.19.0/docs/api/module.html#moduleregisterhooksoptions).
This Node CIL measurement does not qualify source execution, browser hosts, Rust or
native/Wasm allocators. Existing typed-float differential tests remain required for
IEEE boundaries, host edits, exception paths, snapshots and cancellation.
