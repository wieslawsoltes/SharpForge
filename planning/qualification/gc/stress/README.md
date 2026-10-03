# Collect-at-every-allocation programs — SF-A29-T25 / #495

These original fixture programs exercise GC feature categories used by CoreCLR's
GC tests: root retention under allocation pressure, arrays, large allocations,
weak handles and allocation limits. They are not copied CoreCLR programs and do
not claim CLR equivalence. Reference taxonomy:
https://github.com/dotnet/runtime/tree/6f1d9331b9b477df73982a0fabedefe27f36d8a3/src/tests/GC

The harness compiles each program separately for the source VM and CIL VM. In one
isolated synchronous scope it wraps `ManagedHeap.reserve`, collects before every
reservation (including VM construction), forwards all incoming allocation roots,
and restores the original method in `finally`. The production collector and VM
code are unchanged. Collection counts must cover every allocation, rather than
relying on a small threshold that the collector increases after collecting.
Instrumentation rejects overlapping/nested runs. Run the focused tests serially:

```sh
node --test --test-concurrency=1 tests/conformance/gc/stress/stress.test.js
node scripts/conformance/gc/stress.js
```

The runner executes both engines serially and writes the exact outputs, faults,
allocation/collection counts and unsupported features to
`artifacts/gc-stress/report.json`. Heap and instruction budgets bound fixtures.
An intentionally excessive array must fault; it cannot count as a pass merely
because execution stopped. The positive large-array case uses Int32 elements (the selected compiler profile
rejects byte arrays with SF2200) and checks contents after
further allocations, but does not qualify a generational or large-object heap.

Host weak handles use the real JS heap API in a separate boundary test. Managed
`System.WeakReference`, resurrection, finalizer ordering and Rust collection
remain explicitly unsupported until their actual APIs exist. C# exception
`finally` handlers cannot substitute for GC finalization. No synthetic finalizer
trace or Rust result is emitted. Broad cross-platform qualification remains
unknown, even when the supported fixture programs pass on one host.

The manual/`full-ci` workflow runs the bounded suite and always uploads its
report. Ordinary PR checks are unchanged. The task remains open for unsupported
acceptance obligations.
