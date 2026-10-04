# Managed Object.ToString callbacks

The BCL host service `platform.bclHost.invokeObjectToString(platform, receiver)`
now resolves a genuine managed `Object.ToString` override and executes its body.
Its result remains `{handled: true, value}`, where `value` is a managed string
reference or `null`, or `{handled: false}` when the caller should apply its
existing formatting fallback. An invalid return value produces
`InvalidProgramException`.

If host code calls `vm.stop()` during conversion, the service instead returns
`{handled: true, value: null, canceled: true}`. A BCL consumer must return immediately
without validating, allocating, or mutating additional managed storage. The normal
Object builtin simply returns null; the runtime's call result boundary suppresses
any result push after stop, using its existing `SUSPENDED` result convention.

Callers root the original receiver while converting it, invoke the service once,
and root a handled result before allocating or changing managed storage. Mutations
performed by the override commit even when it subsequently throws. This is needed
by APIs such as `StringBuilder.Insert(object)`, whose index and length checks can
depend on mutations during conversion. The BCL operation owns that ordering.

## Slot selection

The source image retains optional `isVirtual`, `isNewSlot`, and `isFinal` flags.
The canonical CIL emitter writes the equivalent MethodDef bits; its loader reads
them from CLI metadata. Debug strings cannot opt a method into virtual dispatch.
Ordinary same-named methods do not override Object. A new virtual slot, and later
overrides of that new slot, leave the inherited Object slot unchanged.

Direct CIL selection reuses `ConstrainedObjectProfile` and
`ConstrainedReferenceObjectProfile`, including the runtime's existing virtual slot
table. `ConstrainedObjectProfile.valuePlan(typeToken)` exposes its metadata-only
value-type plan without requiring a caller-authored Object MemberRef. Existing
constrained calls continue to validate the declaration before using that plan.

This callback path supports nongeneric internal reference hierarchies rooted in
Object and the already admitted nongeneric, reference-free sequential structs.
A boxed struct override receives the existing box interior, so its writes affect
the original box. Primitive boxes preserve their previous type-aware formatting.
The explicit framework opt-ins remain `StringBuilder` and `Uri`.

Generic-owner and explicit MethodImpl override cases outside those existing
profiles fail with `NotSupportedException` when they contain a possible override.
Objects without an override retain their previous fallback. The source compiler
continues to reject general class inheritance and arbitrary virtual dispatch where
it cannot bind and execute them. Its semantic generator admits an ordinary
`ToString` override only after the binder identifies Object's exact public virtual
string-returning slot; existing signature and accessibility diagnostics remain.

`Convert`, `Console`, and the general display/composite formatters keep their
existing profiles. BCL APIs opt into managed conversion by using the service.
Implementing `IFormattable`/format-provider selection is separate from invoking an
already selected managed method.

## Synchronous execution and verification

The execution-owned `invokeManagedMethod` helper uses the normal frame pool,
interpreter, exception unwinder, type-initialization gates, and GC inventory.
An initially unreachable CIL callback is verified before execution using the
existing `verifyCilAssembly` API with bounded `additionalMethodTokens`. That option
adds MethodDef roots to the normal verification traversal. A successful fresh
report retains the original roots and authentic stack-bound proofs; rejection
leaves the prior report intact. No copied method-token list substitutes for proof.
Reverification uses the original normalized launch/verification configuration kept
by the scheduler, so temporary instruction/depth execution budgets cannot replace
the verifier's separate method-size limits.

Interrupted frames and their shared source stack remain live in explicit callback
scopes. The root visitor reads those live containers, including writes made after
entry. Managed addresses still resolve their original caller frames. Stack-budget
rebuilds and method-event reconciliation include retained scopes. Scheduler saves
cannot overwrite an interrupted context while execution is suppressed.

On ordinary completion or failure the helper restores caller frames, stack, run/pause state, source point, pending
fault, fault, return value, exit code, exception observer, scheduler suppression,
and execution limits. Output and managed state mutations remain.
An escaping managed fault is raised again at the enclosing managed call boundary,
where the caller's catch/finally and debugger exception policy apply normally.
The callback cannot remain paused or waiting. Pending waits use the scheduler's
existing synchronous-evaluation rejection; abandoned callback frames are retired.

Shutdown cancels all active callback scopes before retiring their storage. Canceled
continuations restore only host observers and configuration; they never restore
disposed frames, pending faults, or previous run state. Execution snapshot and
restore reject active callback scopes before mutating any state, because an in-memory
VM snapshot cannot represent the JavaScript continuation returning into a builtin.
Independent heap snapshots remain available. Runtime-event subscriber delivery is
buffered until the enclosing host slice boundary, so a subscriber exception cannot
be caught by a managed catch. A direct host caller can explicitly flush the event
log after its synchronous callback returns or throws.

Abandoned initializers settle to a sticky failed state even if managed memory is
insufficient for `TypeInitializationException`. Their original managed cause remains
rooted in initialization state. If wrapper allocation itself escaped as
`OutOfMemoryException`, its `initializationFailure` retains that initiating fault;
secondary retirement/notification failures are retained in `cleanupErrors` on the
original thrown error. Initializer waiters always become ready to retry the failed
instruction, including when a host task-write observer interrupts normal completion.

`maxSynchronousInstructions` defaults to 20,000 per BCL conversion. Nested callbacks
also obey the enclosing instruction limit and share its remaining managed frame
depth. Retained callback scopes are additionally capped at 128. Instruction and
depth exhaustion are fatal execution-limit faults. Host callers can configure a
smaller instruction allowance; the value must be a positive safe integer.

## Focused validation

Run through the repository's serial validation lane:

```sh
node scripts/limited.js node --test tests/a05-object-string-metadata.test.js tests/a05-callback-verification.test.js
node scripts/limited.js node --test tests/a05-managed-object-string.test.js
node scripts/limited.js node --test tests/a05-synchronous-callbacks.test.js tests/a05-callback-lifecycle.test.js
node scripts/limited.js node --test tests/a07-framework-object-string.test.js tests/a05-constrained-object-tostring.test.js tests/a05-constrained-reference-tostring.test.js
node scripts/limited.js node --expose-gc scripts/benchmarks/a05-managed-object-string.mjs 1000 --mode candidate
```

The new tests cover source and independently authored CIL, canonical round trips,
null/empty/string returns, managed faults, mutation, nested callbacks, hidden slots,
boxed struct mutation, live GC roots, caller byrefs, authentic verifier proofs,
runtime observers, cancellation, snapshot rejection, initializer OOM/waiter cleanup,
limits, and full caller restoration. The benchmark includes the
new callback path and existing primitive/framework/Convert controls, reports
median/p95 timings, managed allocation counts, and collection counts. Each workload
uses five warmups and nine measured samples, and retains both sets in the report.
Run the identical script with
`--mode baseline` on the baseline revision. Both modes compile with the legacy
pipeline and use identical control sources declaring an empty `Value` class;
source and assembly SHA-256 values are recorded for reproducibility. The new managed
override workload runs only on the candidate and requires the exact `managed`
result. Baseline records that workload as unsupported, with no timing: baseline
source admission rejects the override declaration. No fallback timing is used as
a managed callback comparison.

For regression qualification, select one engine and one workload per fresh Node
process. Both options are optional for an all-workload exploratory run:

```sh
node scripts/limited.js node --expose-gc scripts/benchmarks/a05-managed-object-string.mjs 5000 \
  --mode baseline --engine cil --case primitive-control
node scripts/limited.js node --expose-gc scripts/benchmarks/a05-managed-object-string.mjs 5000 \
  --mode candidate --engine cil --case primitive-control
```

Repeat each of `primitive-control`, `framework-control`, and `formatting-control`
on both `source` and `cil`. For each engine/workload pair, run baseline, candidate,
candidate, baseline in separate processes on a quiet machine. Keep every report
under a distinct filename, check matching source/assembly hashes and exact outputs,
then pool the two processes' measured samples for each revision. Retain the
original exploratory reports as well. Their candidate runs execute the new callback
before the controls while baseline skips it, so they have different interpreter
warmup histories; a single warmup also left declining measured samples.

Measure `--mode candidate --case managed-override` separately with each engine.
Running this workload before the controls can change shared interpreter/JIT
profiles and object shapes even though each sample constructs a new VM. Isolated
controls distinguish ordinary-call overhead from that mixed-workload effect;
they do not establish that callback activation has no later performance cost.
Baseline with `--case managed-override` continues to report unsupported without
compiling or timing it. The report records the selected engine/case and whether
exactly one workload was selected.

These commands must be measured and recorded by the owning validation lane;
neither native CLR nor Rust/Wasm execution is claimed by this JavaScript leaf.
