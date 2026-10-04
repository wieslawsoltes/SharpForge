# Bounded Wasm loop hotness

The opt-in [call-entry tier](wasm-call-tiering.md) now counts successful backward
`br`, conditional branches, and `switch` transfers. A source/target pair reaches
`backedgeThreshold` independently of other pairs and queues the method through
the existing bounded, one-attempt-per-generation compilation policy. Call counts
continue to use `callThreshold`. Both thresholds default to finite integers:
256 back-edge hits and 32 calls.

```js
const vm = new CilVirtualMachine(bytes, {
  wasmTiering: {backedgeThreshold: 64, callThreshold: 32, maxBackedgesPerMethod: 64}
});
```

Only dispatch that returned successfully is observed. The original frame object
and fresh frame id must still be active, its instruction must match the method,
and the resulting PC must be at or before the source instruction. A branch to
itself counts. A not-taken conditional and the default switch fall-through do
not. Calls, returns, throws and `leave` unwind destinations are not loop sites.
The existing step envelope provides the observation for both ordinary and
manual compiled dispatch; there is no second instruction loop or stack analysis.

The first observed transfer cold-checks the exact canonical body using the
existing verification proof. Its work is bounded by `maxMethodInstructions` and
the same metadata work limit as IR eligibility, including unreachable switch
tables. Cold refusal is visible in `backedgeReason`: `WASM_UNVERIFIED`,
`WASM_SIZE`, or `WASM_ANALYSIS_LIMIT`. Later body/header replacement sets
`WASM_STALE`; in-place semantic edits still require code invalidation and
reverification. Unproven bodies continue through the existing checked
interpreter path and do not accumulate trusted back-edge counts.

Each tracked method retains at most `maxBackedgesPerMethod` source/target pairs
(default 64, accepted range 1–1,024). Warm hits use indexed lookups with no new
counter objects. Counters saturate at `Number.MAX_SAFE_INTEGER`. Method capacity
is still bounded by `maxMethods`; untracked methods have no edge table.

`wasmTieringStatistics(vm).methods` adds:

| Field | Meaning |
| --- | --- |
| `backedges` | Total verified taken backward transfers |
| `hottestBackedge` | Largest retained source/target count |
| `backedgeSites` | Frozen rows `{fromOffset, toOffset, count}`, sorted by IL offsets |
| `backedgeOverflow` | Transfers whose distinct site could not be retained |
| `backedgeReason` | Cold proof/budget refusal or stale-body reason, otherwise null |

Overflow sites do not combine into a synthetic hot loop. Once retained site
capacity is full, existing sites keep counting and new sites only increment
overflow. Code epochs, stop, disposal and restore drop the tables along with
other derived tier state. A restored frame may establish new edge counters
without being counted as a method call or retroactively selected for execution.

Compilation readiness still affects only a subsequent method call. The active
loop remains interpreted, and host yielding is necessary for asynchronous
preparation to settle. On-stack replacement remains a separate open part of
[SF-A05-T11.3 / #1407](https://github.com/wieslawsoltes/SharpForge/issues/1407);
this leaf does not claim a same-invocation tier transition or performance gain.
Source VM and Rust backends are outside this direct-CIL policy.

All 70 focused tests passed serially on Node 24 at `1a709ad9`: back-edge
counters, call-entry tiering, manual bridge, eligibility, method events and
instruction profiling. Broad native/browser qualification and performance
measurements remain deferred.
