# A05 T31 instruction-boundary preemption

`Array.Sort` and `Array.Reverse` no longer enter a whole-array JavaScript native
operation from a managed instruction. A frame holds a plain
`intrinsicContinuation` until the operation completes. Sorting uses in-place
heapsort with constant auxiliary storage; reversing exchanges one pair at a time.
The ordering comparison retains the existing null, numeric, NaN, boolean, Int64,
and English-locale string behavior. This task changes scheduling, not the runtime's
supported comparer surface.

One charged work unit performs at most 32 constant-size steps, with at most two
comparisons per sorting step. Continuation execution checks the slice deadline
before each unit. Ordinary opcode execution checks time at work counts divisible
by 256. A continuation unit consumes the instruction and scheduler quantum budgets,
so a long operation cannot monopolize a logical context or bypass the instruction
limit. It resumes before the frame's next source/CIL instruction. The source
builtin's placeholder result is pushed only when its continuation completes.

| Surface | Capability |
| --- | --- |
| Source and CIL | Shared resumable Sort/Reverse; zero budget boundaries; negative or nonfinite budget rejection |
| Scheduler | Continuation belongs to its frame, survives context parking, and yields work to another ready context |
| GC | `arrayContinuationRoots(frame)` retains its array even after call arguments have been popped |
| Snapshots | Plain continuation state is copied with frames; heap contents rewind independently; no host closure, iterator, or Promise is retained |
| Cancellation and faults | Stop/cancel drops owning frames; injected faults call `cancelArrayOperation(frame)` before catch/unwind processing |
| Standalone builtin seam | A context with no active VM frame still completes synchronously; it has no `runSlice` contract |
| Tiered execution | Unsupported until E02 T11 supplies a tiered executor; its future basic-block path must charge the same work/deadline contract |
| Other blocking work | Host callbacks, heap collection/allocation, locale comparison, and other intrinsic families retain their existing scheduling contracts |

Root-owned integration must validate budgets before mutating execution state,
then, before decoding an opcode, handle `frame.intrinsicContinuation` using
`resumeArrayOperation(vm,frame,{deadline:started+timeBudgetMs,workBudget:1})`.
Charge the returned `work` to both the slice counter and `vm.instructions` and run
the scheduler quantum hook. If `done && returns`, push `value` on the source
evaluation stack; CIL Sort/Reverse return void. A zero-work result at an expired
deadline ends the slice. Preserve ordinary debugger callbacks at opcode boundaries
and execute the next opcode only after the continuation finishes.

Active and parked frame root walks must yield `arrayContinuationRoots(frame)`.
`copyFrames` already copies continuation state; snapshot validation can use
`validateArrayContinuation(vm,frame,snapshotRecord)`. Its owner and frame identity
must match. The array's length cannot change while a continuation is live. No
new VM-level mutable field is required. Add `RankException` to the exception
inheritance inventory for attempted Sort/Reverse on rectangular arrays.

`tests/preemption.test.js` includes instruction boundaries, work bounds, malformed
state, ownership, snapshot replay, sole continuation roots, context fairness,
instruction-limit failure, async cancellation, and the explicit million-element
Sort gate. The latency gate requires each measured eight-millisecond slice to be
at most sixteen milliseconds; it does not silently discard outliers. JavaScript
host pauses are observable in the measurements, so this is an empirical workload
gate rather than a hard real-time scheduling guarantee.

The source and independently authored CIL fixtures allocate and populate the test
array before timing starts. This isolates the long-running intrinsic from input
construction. The ordinary-loop workload separately measures the existing
256-instruction cadence. Native sort correctness remains covered by the existing
`array sort` compiler/CIL fixture; VM slice timing has no corresponding native
`runSlice` API.

All validation is deferred until the E01 integration is assembled. Planned commands:

```sh
node --test tests/preemption.test.js
node scripts/benchmarks/a05-preemption.mjs --output artifacts/a05-preemption/node.json
node examples/runtime/preemptible-sort.mjs
```

The benchmark records cold/warm first-slice, median, p95/p99, maximum latency,
per-slice samples, instructions/work, managed allocation counts, observed host-heap
change, Node version, platform, and exact command. Host-heap change is not an exact
JavaScript allocation count. Browser results require a separate browser harness
running the same source/CIL fixtures; Node evidence is not browser qualification.
