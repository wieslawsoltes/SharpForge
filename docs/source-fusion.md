# Source dispatch preparation and fusion

SF-A05-T07.5 ([#1394](https://github.com/wieslawsoltes/SharpForge/issues/1394))
adapts the retained source fusion implementation to the current opcode handlers.
`VirtualMachine` delegates its instruction boundary loop to `execution/source-slice.js`.
The source and assembly-reloaded source VM support the `sourceFusion` option;
`false` selects ordinary dispatch, while the default enables eligible groups.

Preparation scans a method once in O(instructions) time and space. It creates
immutable blocks of at most 32 instructions, ending at a branch, call or return.
Decoded scalar operators reuse the shared i4 numeric primitives after checking
both operands are canonical primitive Int32 values. Other numeric carriers,
checked modes, Decimal scale and IEEE signed zero use the ordinary evaluator.
Stores and frame transitions still use the existing authoritative handlers;
assigned values and local-write accounting retain their original semantics.
No JavaScript code is generated and no source opcode or serialized format changes.

## Boundaries and invalidation

Every contained instruction advances the PC and instruction counter before its
handler. A failed load or arithmetic operation retains the same partial stack,
failing address and counter as ordinary execution. Execution may take a prefix
of a prepared block to fit either instruction budget or the next 256-instruction
wall-clock polling boundary. Verified stack admission precedes selection.
Branch targets begin blocks. A call or return ends its block, so frame admission,
root registration and retirement retain their ordinary boundaries. Sequence
instructions update the current source location individually; active sequence
callbacks select ordinary dispatch. Object/array operations and protected
methods keep their own dispatch boundaries.

Sequence callbacks, write/exception observers, runtime events, profiling,
instruction-GC stress, cooperative scheduling, intrinsic continuations, filters
custom write transactions and active finally unwinds select ordinary instruction dispatch. Attaching these
facilities does not lose instruction counts, events or stepping information.
The scheduler is checked again after ordinary handlers that can activate it.

Caches belong to the VM's private execution-code state, never its guest frames,
roots or snapshots. Replacing the image, method code array, handler array, or
method-table registry invalidates the relevant plan. In-place committed code or
metadata edits must call the existing `invalidateExecutionCode` API. Stop drops
source plans alongside other derived execution caches. Snapshot restoration owns
the corresponding successful-restore invalidation; rejected restores retain the
live code state.

The internal `prepareSourceExecution(vm)` reports `status`, scanned `methods`,
and the number of `fusedInstructions` covered by nonoverlapping groups. Disabled
fusion reports zero work. The shared public `prepareExecution(vm)` adapter uses
this phase. `executionCodeStatistics(vm)` includes `sourcePlans`,
`sourcePlanMilliseconds`, and actually executed `sourceFusionGroups`.

## Qualification and measurement

`tests/a05-source-fusion.test.js` and `tests/a05-source-fusion-blocks.test.js` compare bounded slice state, failed instructions,
global/stack/time budgets, scalar representations, sequence observations,
profiling/events, code invalidation and in-memory replay with ordinary dispatch.
Portable snapshots and native/CIL/Wasm execution remain separate qualifications;
fusion changes the JavaScript source dispatcher only.

After the shared preparation adapter is integrated, run the paired comparison:

```sh
node scripts/limited.js node bench/vm/source-fusion.js
```

It checks Fibonacci and integer-loop output and equal guest instruction counts,
then emits raw interleaved samples, cold construction/preparation time, execution
median/p95, managed allocations and actual fused-group counts. `meetsTarget`
reports whether the measured median ratio reaches the issue's 1.5× requirement.
No speedup or target completion is claimed before the scheduled serial run.

The first handler-only implementation measured 1.11× for the integer loop and
1.07× for Fibonacci on the integration runner, below both 1.5× targets. The
bounded-block measurements are recorded below. The authoritative target
matrix remains `bench/vm/qualification-fixtures.js` and its execution driver
`bench/vm/qualification-execution.js`.

## Prepared call and return boundaries

Fixed-arity static calls with primitive argument/local types can use a cold
callee descriptor. Their arguments remain in the shared stack as roots until
the registered pooled frame owns them; no temporary argument buffer or optional
argument packet is created. Argument normalization, frame identity issuance,
stack-byte reservation, registration and failed-admission rollback keep their
existing owners. Aggregate, instance and vararg calls retain ordinary preparation.
Callee metadata replacement declines the descriptor; committed in-place edits
use the execution epoch invalidation contract above.

A block's final return can omit empty finally and continuation searches only
under the block's no-observer/no-handler/no-continuation guards. It still performs
typed return normalization, frame retirement, capability revocation, pool flushing
and the shared caller/terminal result delivery. Custom `call`, arithmetic,
constant, transfer or write adapters select ordinary dispatch, including inherited
subclass adapters and prototype replacements made before VM construction. Canonical
function identities are captured once and retained outside the guest graph.

`tests/a05-source-prepared-calls.test.js` checks source and reloaded recursion at
each slice, exact frame identities, global/depth/stack quotas, storage-plan
invalidation and aggregate fallback. All six prepared-call tests and the source
fusion tests passed in the full integration run at `17f2620c`. The prepared-call
performance measurements appear below.

The 20-pair run at integration `9ab4a805` measured the bounded blocks at
194.779 ms baseline / 103.199 ms candidate for the integer loop: **1.8874×**, with
95% paired interval [1.7889, 1.9565], meeting its 1.5× target. Fibonacci remained
66.583 / 66.388 ms: **1.0029×**, interval [0.8968, 1.0633], missing its target.
These are the results before prepared calls/returns, not a prediction for them.

The unchanged Fibonacci qualification at integration `6cea3cb3`, including
prepared calls/returns, measured **1.0849×**, paired interval
[1.0322, 1.1162], still below 1.5×. The next candidate batches eligible blocks
within the existing slice and 256-instruction clock budget. It reuses observer
eligibility only through callback-free decoded instructions and prepared static
calls, while every executing frame retains its own continuation guards, stack
admission, PC, identity, fault context and retirement flush. An ordinary call,
managed fault, protected body or unsupported instruction ends the batch.

`tests/a05-source-fusion-batch.test.js` covers nested calls and returns, partial
slice/quota boundaries, a later callee's fault, protected caller recovery,
unprepared call exit and live caller stack roots during a callee allocation.
The integrated validation and unchanged paired measurement appear below.

`tests/a05-source-adapter-guards.test.js` checks inherited call, arithmetic,
transfer, constant and write hooks plus preconstruction prototype replacement.
These six additional host-hook cases passed in the integrated serial run.

At integration `000bbabd`, all six batch tests and the adapter cases passed. The
unchanged 20-pair Fibonacci run measured 54.906 ms baseline / 42.064 ms candidate:
**1.3053×**, with 95% paired interval [1.2128, 1.4033], still below 1.5×. A separate
quiet V8 CPU profile at that same commit attributed 30.69% of candidate guest
samples to frame-pool flushing and 10.16% to acquisition. These are diagnostic
sample shares, not another speedup measurement. Both modes executed 5,253,940
guest instructions across 20 profiled observations using the unchanged fixture.

The next candidate binds prepared source call storage to a private current-pool
bucket and uses stable stores for fixed frame cleanup, while retaining dynamic
own-field cleanup and all ordinary retirement boundaries. See
[managed frame storage reuse](frame-pool-runtime.md). All 122 combined pool,
fusion and frame-index tests passed at `48c62243`, including seven new storage
authority and cleanup cases. The unchanged 20-pair Fibonacci qualification
measured **1.48069×**, interval [1.34064, 1.60855]. A prespecified 100-pair repeat
at the same clean revision measured **1.47278×**, interval [1.41347, 1.52400]. Both
are inconclusive against 1.5×, with point estimates below it. The benchmark
reference, options and threshold are unchanged, and both reports are retained in
[the evidence bundle](a05-evidence/source-fibonacci-2026-10-04/README.md).
