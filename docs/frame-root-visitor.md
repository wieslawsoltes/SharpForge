# Frame root visitor and optional last-use pruning

Source and CIL collection use a shared T09.2 visitor
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
read them. Retained callback scopes remain roots even when ordinary scheduling
is disabled. Free pooled frames remain cleared and are not roots. Stack admission,
instruction budgets and snapshot schema are unchanged. Derived liveness plans
are kept privately per code epoch; they are not functions or plans attached to a
VM/frame/snapshot graph.

`preciseRoots: false` uses the generic iterable path, retaining the same managed
inventory without scalar filtering. The public VM, scheduler and EH generators
share the visitor inventory through borrowed container groups, avoiding two
independently maintained root lists and a second array containing every numeric
frame slot. Compatibility iteration streams each borrowed container in order. Later overrides of `vm.roots` also retain the
iterable provider behavior. With the default `preciseRootLiveness` setting,
collection omits null/uninitialized values without clearing last-use slots.

`preciseRootLiveness: true` additionally enables proof-based pruning before the
precise visitor runs. Eligible active frames can clear an owned managed reference
from a reference-typed argument/local when it is dead at both the current and
previous instruction boundary. Address-taken slots captured through the managed
address APIs remain roots for the frame lifetime. Scalar, aggregate, byref,
unknown and malformed host-edited values are never removed on a declaration
alone. Setting `preciseRoots: false` also disables this pruning pass.

Plans require the current successful stack proof and a bounded liveness analysis;
code/metadata replacement removes that authority. Methods with EH regions,
active filter/unwind/delegate/array/object continuations, and paused/faulted or
pending-fault execution stay conservative. Parked contexts, callback scopes and
retired frames retain their separate root inventory. These fallbacks deliberately
retain objects where last-use proof is unavailable. Snapshot capture preserves
captured-slot sets and live values; restore derives fresh plans.

Run `node examples/runtime/reference-slot-liveness.mjs` to observe a dead slot
cleared and its weakly held object collected. Focused source/CIL coverage is in
`tests/a05-reference-slot-liveness.test.js`; the broader
[frame capability table](a05-runtime-capabilities.md#frames-and-roots--82--t09)
links lifecycle, callback, quota and pool regressions.

No 3x timing improvement is claimed. Last-use pruning is now implemented as the
optional contract above; the 500-frame timing target in #1400 still requires its
separate qualification. The following result describes the earlier conservative
visitor revision, not the later pruning implementation: serial Node 24.21.0
validation at `3c077c19` passed all 86 focused root, GC,
resumed-fault, pooled-frame, argument-buffer and profiler regressions, including
source, reloaded-source and direct-CIL coverage. Core static/build validation is
recorded on the PR. Benchmarks and native/Rust/Wasm qualification remain open.
