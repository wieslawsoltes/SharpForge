# SF-A05-T08 implementation and qualification scope

The four numeric product slices are implemented for direct CIL and compose with
T07's decoded-handler contribution. Source execution retains its existing shared
numeric semantics. No E02 test, benchmark, browser or native run has been performed
by this workstream; the integration owner schedules validation serially.

| Slice | Implemented behavior | Control |
| --- | --- | --- |
| T08.1 | Raw Single/Double stack, local and argument planes; canonical values at generic/debug/snapshot boundaries | `typedNumericStack:true` |
| T08.2 | Conservative category dataflow selects Int32, Int64, float and compare-branch handlers at decode time | `specializeNumericHandlers:false` restores generic dispatch |
| T08.3 | Safe 53-bit Number lanes retain an Int64 tag; exact BigInt fallback handles wide values and overflow | `smallLongFastPath:true` |
| T08.4 | Normalized immutable local/argument/instance/static fields are reused; writes retain one normalization boundary | `scalarSlotLoads:false`, `scalarFieldLoads:false` restore read normalization |

`specializeNumericHandlers:false` also disables the typed-handler contributions.
T07 cache keys include both opt-in representation flags. Each decoded plan retains
original instructions and generic handlers for unknown or unproved categories.
External intrinsic results and native pointer values do not authorize an arithmetic
specialization merely from their apparent signature.

T09 integration uses `numericSlotRoot` for root reads and may use
`releaseTypedNumericFrame` when pooling frames. Neither numeric planes nor decode
functions enter snapshot data. Observed writes keep the existing managed-pointer
notification path; unobserved proven scalar writes still advance the write revision.

Prepared regression files cover slot and field reads, type joins, managed faults,
float precision/NaN/signed zero, unsigned float conversions, snapshots, root scans,
write observers, one million Int32 differentials and ten million Int64 differentials.
The native remainder boundary discovered during E01 qualification is shared with
the specialized Int32 handlers.

The acceptance measurements remain open: total JS allocations per floating loop
iteration, at least 2x Int32 throughput, at least 3x long-counter throughput, and at
least 30% lower instruction-normalized slot latency. Materialization counters are
structural diagnostics, not complete host-allocation measurements. The default-off
representation flags must not be presented as measured speedups or platform passes.
Heavy differential suites and benchmarks must run one process at a time under the
integration owner's queue, without concurrent oracle generation or browser runs.
