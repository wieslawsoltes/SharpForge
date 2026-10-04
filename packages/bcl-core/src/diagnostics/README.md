# Stopwatch

`System.Diagnostics.Stopwatch` implements its complete declared .NET 10.0.5
surface: the constructor, StartNew, Start, Stop, Reset, Restart, IsRunning,
Elapsed, ElapsedMilliseconds, ElapsedTicks, GetTimestamp, both GetElapsedTime
overloads and the ToString override. Frequency and IsHighResolution are genuine
static readonly fields. They are not constants or properties; their metadata
does not introduce getter contracts.

## Clock and platform contract

The execution profile uses the pinned Unix counter frequency of
1,000,000,000 ticks per second and IsHighResolution=true. A counter tick denotes
one nanosecond. Host sampling resolution can be coarser; browser timer privacy
settings and scheduling remain host responsibilities. This profile does not
reproduce the platform-dependent Windows QueryPerformanceCounter frequency.

Each VirtualMachine or CilVirtualMachine accepts an optional synchronous host
callback in its existing options object:

```js
let timestamp = 0n;
const options = {stopwatchClock: () => timestamp};
// Pass options to VirtualMachine(image, options) or CilVirtualMachine(assembly, options).
timestamp += 1_500_000_000n; // exactly 1500 milliseconds
```

The callback returns an exact bigint in the inclusive range
0..9223372036854775807. Successive reads on one platform must not decrease.
Equal readings are allowed. The default adapter reads performance.now() and
converts finite, nonnegative milliseconds to nanoseconds. No wall clock is used.
Clock selection is cached on that platform at its first read; changing an
options object later does not replace an active clock. Distinct VMs have distinct
clock state. A shared callback remains explicitly shared host configuration.

Execution snapshot and restore are unavailable while the clock callback or its
synchronous result inspection is active. These VM APIs throw TypeError before
changing execution or managed state. A callback may catch that rejection and
return a valid timestamp; the rejected snapshot operation does not poison the
sample. The platform-owned boundary is released after success, failure or stop,
and ordinary between-call snapshot and restore remain available.

Asynchronous clocks remain unsupported. Returning an ordinary native Promise
still raises BCLSW0004; the adapter observes both its fulfillment and rejection
only to avoid an orphan host rejection or forwarding its payload. Foreign
thenable properties are neither read nor assimilated. Native Promise constructor
and species accessors run within the synchronous boundary when a reaction is
installed. Custom species constructors and throwing constructor/species accessors
are outside this host contract: they can prevent reaction installation or arrange
their own callbacks after the boundary. No hook-free guarantee is made for those
customized Promise objects.

Invalid options raise ArgumentException with BCLSW0001; an unavailable monotonic
host source raises PlatformNotSupportedException with BCLSW0002. Callback
failures, invalid timestamps, decreasing timestamps and reentrancy raise
InvalidOperationException with BCLSW0003, BCLSW0004, BCLSW0005 and BCLSW0006,
respectively. These bounded diagnostics are explicit host-profile behavior.
An unsuccessful read does not change the Stopwatch's managed state or the last
accepted host timestamp. Reset, stopped reads, Start on a running instance and
Stop on a stopped instance do not consult the clock.

If a clock callback stops its VM, the pending operation is canceled before any
state transition, duration/string allocation or result publication. Its returned
timestamp is discarded, including when the callback throws after stopping; the
last accepted timestamp is retained. Temporary roots and the active read marker
are released. StartNew may already have allocated its fresh, stopped instance
before sampling, but does not start or return it after cancellation.

On an undisposed platform, natural completion of Main retains host-side Stopwatch
inspection and transitions. An explicit stop remains observable even if Main
already completed. Restoring live execution between callbacks permits pure BCL
continuation while the platform's external host operations remain closed.

A callback cannot reset the same Stopwatch whose state the active operation has
captured. This fails with BCLSW0006 before changing any fields. That diagnostic,
like a recursive clock read, remains sticky if host code catches the nested
error. Resetting a different Stopwatch remains a clock-free operation.

## Exact state, durations and snapshots

The accumulated counter, start counter and running flag occupy three fixed
managed fields. All elapsed arithmetic uses exact bigint values and signed Int64
wrap semantics. Conversion to duration ticks follows CoreCLR's binary64
multiplication and truncation, including its rounding above 2^53. It deliberately
does not substitute rational integer division for that specified conversion.
ElapsedMilliseconds divides the resulting duration ticks by 10,000 with integer
truncation. ToString formats those ticks using TimeSpan's constant format.

Returned TimeSpan objects preserve exact duration ticks in a private managed
slot and retain the established TotalMilliseconds representation. The separate
generic TimeSpan totals prerequisite derives both existing total getters directly
from exact ticks when present, avoiding an additional rounding step for seconds.
This addition does not advertise new public TimeSpan.Ticks, constructors, parsing
or formatting methods. The private slot is an implementation detail.

Snapshots copy all three Stopwatch fields and exact duration ticks. Restoring a
running snapshot restores its earlier start/accumulated state while the host
clock continues; elapsed readings therefore include time since that start and
do not rewind with the host clock. The per-platform clock's last accepted
timestamp and callback are host configuration and are not restored. A decreasing
injected clock after restoration fails explicitly.

Restoring an older stopped snapshot restores that snapshot's accumulated elapsed
value. Reset and Restart also intentionally clear accumulated time. A blanket
promise that every restored stopped value must exceed all future values would
conflict with restoring managed state; it is not made by this implementation.

State updates commit all three fields before write observers run. Observers may
collect safely; if an observer throws, the complete transition remains committed
and temporary roots are released. Transition and timestamp operations take
constant time and fixed managed space, with no new managed allocation. Construction
allocates one object; Elapsed/GetElapsedTime allocate one duration; ToString
allocates one bounded string. Existing managed heap budgets govern those objects.

## Evidence and qualification

The checked-in reference at `../../reference/stopwatch-net10.json` was captured
on Linux x64 with SDK 10.0.201 and CoreCLR 10.0.5. It contains 54 public
GetElapsedTime vectors, 20 actual metadata records and ordinary public state
observations. The capture records source and runtime assembly SHA-256 digests,
including the System.Private.CoreLib 10.0.0.0 identity. See the reference program
and its README for reproduction and the pinned native source links.

Focused tests cover both compiler pipelines, both VMs, independent ordinary CIL,
all native duration vectors, counter precision, no-op transitions, clock failures,
allocation limits, collection in clock/write callbacks, independent VMs and
managed snapshot restoration. The readonly-field prerequisite supplies genuine
source field loads and ordinary CIL ldsfld admission. Browser execution beyond
the performance-clock host contract requires its own runner qualification;
neither that runner nor a Windows-specific counter profile is implied by the
Linux native capture.

Focused host-boundary cases cover snapshot and restore attempts during both
instance and static clock reads, cleanup after callback failures/reentry/stop,
and constructor/species hooks during invalid-result inspection. Async-clock cases
run on source and CIL platforms, including ordinary rejected Promises, untouched
foreign thenables, and fulfilled payloads that must never be forwarded.

## Performance comparison

Copy the identical `scripts/benchmarks/a07-stopwatch.mjs` runner to the baseline
worktree and run both revisions serially with
`node --expose-gc scripts/benchmarks/a07-stopwatch.mjs 1000 REVISION`.
The selected baseline is `fbb0b086e05720eeacb954800a4a690a644313cd`, which includes
the shared allocation-observer lifetime prerequisite. Both revisions use the same
fixed policy: 100..5000 calls per sample, five warmups and nine retained samples.
The runner SHA-256 is
`4bee6a1f0dfb693df5a8a13a4b953d648d11e370682d43c5b94bd678f89ae289`.

Use `--engine source|cil --case NAME` to isolate one workload in a fresh process
for each revision. For example, append `--engine source --case totalMilliseconds`
for the existing TimeSpan getter or `--engine cil --case objectToStringBuilder`
for the existing framework virtual-string path. The runner records actual Git
revision separately from its caller-supplied label, source/assembly/runner hashes,
engine selection and execution order.

The report includes all raw samples and median/p95 time, managed allocations,
bytes and collections for both VM platforms. Existing TimeSpan Zero,
FromMilliseconds, TotalSeconds and TotalMilliseconds, plus StringBuilder through
Object.ToString, run on both engines before any new Stopwatch workload. A baseline
without Stopwatch reports that family as absent. New workloads cover injected
and default clocks, construction, StartNew, Start/Stop cycles, elapsed counters,
duration totals and ToString. Setup, explicit collection and result checks are
outside measurement; automatic managed collection remains part of operation cost.
No speedup or performance qualification is implied until both runs are captured.
