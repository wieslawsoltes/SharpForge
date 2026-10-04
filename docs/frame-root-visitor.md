# Conservative frame root visitor

This partial T09.2 increment gives source and CIL collection a shared visitor
inventory. The heap accepts either `rootProvider(visit)` delivering values directly,
or an existing provider returning an iterable. VM providers continue returning an
iterable without an argument, as required by retention-path diagnostics.

Frame arguments and locals with canonical scalar representations bypass the heap's
reference scan. Classification reuses `scalarStorageGuard` and reads live metadata
on every scan. It does not trust the declaration alone: a host-edited scalar slot
containing a managed handle or owned byref remains rooted, including a handle with
extra numeric-carrier properties. Reference, enum, aggregate, modified and unknown
slots remain conservative, as do all evaluation-stack slots. This does not add new
aggregate representations or change the heap's existing edge tracing.

The inventory includes parked scheduler contexts, resumed faults, managed-address
owners, return/EH continuations, static-initialization state, strings, runtime types,
platform roots, statics and source constants. Retired pooled frames are deliberately
retained until their instruction's flush because return/unwind callbacks can still
read them. Free pooled frames remain cleared and are not roots. Stack admission,
instruction budgets and snapshot schema are unchanged; there is no cached root plan
or function attached to a VM/frame/snapshot.

`preciseRoots: false` uses the generic iterable path, retaining the same managed
inventory without scalar filtering. The public VM, scheduler and EH generators
share the visitor inventory through borrowed container groups, avoiding two
independently maintained root lists and a second array containing every numeric
frame slot. Compatibility iteration streams each borrowed container in order. Later overrides of `vm.roots` also retain the
iterable provider behavior. Collection omits null/uninitialized values but never
clears a local or treats it as dead after its last use.

No 3x timing improvement is claimed. The 500-frame timing target and last-use
liveness acceptance in #1400 remain open. Serial Node 24.21.0 validation at `3c077c19` passed all 86 focused root, GC,
resumed-fault, pooled-frame, argument-buffer and profiler regressions, including
source, reloaded-source and direct-CIL coverage. Core static/build validation is
recorded on the PR. Benchmarks and native/Rust/Wasm qualification remain open.
