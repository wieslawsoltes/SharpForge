# Source dispatch preparation and fusion

SF-A05-T07.5 ([#1394](https://github.com/wieslawsoltes/SharpForge/issues/1394))
adapts the retained source fusion implementation to the current opcode handlers.
`VirtualMachine` delegates its instruction boundary loop to `execution/source-slice.js`.
The source and assembly-reloaded source VM support the `sourceFusion` option;
`false` selects ordinary dispatch, while the default enables eligible groups.

Preparation scans a method once in O(instructions) time and space. It creates
immutable groups for local/local or local/constant arithmetic, optional stores
and discarded assignment values, and comparison/conditional-branch pairs.
Groups call the existing load, arithmetic, store and control handlers at fixed
call sites. They preserve typed numeric carriers, Decimal scale, IEEE signed zero,
the assigned value remaining on the stack, and ordinary local-write accounting.
No JavaScript code is generated and no source opcode or serialized format changes.

## Boundaries and invalidation

Every contained instruction advances the PC and instruction counter before its
handler. A failed load or arithmetic operation retains the same partial stack,
failing address and counter as ordinary execution. A group is selected only if
its entire length fits both remaining instruction budgets and the next
256-instruction wall-clock polling boundary. Verified stack admission precedes
selection. Branch targets cannot enter the middle of a group; sequence points,
calls, object/array operations and protected methods keep their own boundaries.

Sequence callbacks, write/exception observers, runtime events, profiling,
instruction-GC stress, cooperative scheduling, intrinsic continuations, filters
and active finally unwinds select ordinary instruction dispatch. Attaching these
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

`tests/a05-source-fusion.test.js` compares bounded slice state, failed instructions,
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
