# GC roots: providers and publication obligations

The collector calls `ManagedHeap.visitRoots(visitor, extraRoots)`. Both interpreters install `heap.rootVisitor`; standalone heaps may retain the legacy `heap.rootProvider` iterable. The visitor receives `(reference, category, detail)`. It emits valid managed identities and owners of interior byrefs, and ignores primitive values. The legacy `roots()` generators are compatibility adapters; collection does not allocate those generators.

Categories are defined once by `RootCategory`: `stack`, `static`, `handle`, `pinned`, `finalizer`, `scheduler`, `host-operation`, `interop`, and `debugger`. Collection counters expose `rootsScannedByCategory`; retention paths use these labels. The identity generation in `{h,g}` is independent of the collection generation.

## Reviewed provider inventory

| Owner and provider | Category | Managed values retained |
| --- | --- | --- |
| Source VM / CIL VM, `visitVMRoots` | stack | Evaluation stack, locals, CIL arguments, constructor return object, return value, caught/pending/current exceptions, unwind return and exception continuations, recursively normalized byref owners |
| VM statics and caches, `visitVMRoots` | static | Static slots, dynamic constants, strong dynamic intern entries, canonical runtime type objects, failed initializer exceptions and initialization wait tasks |
| `CooperativeScheduler.visitRoots` | scheduler | Nonterminal context task/thread/delegate, wait task, parked execution state, resumed exceptions; unfinished task dependencies and faults |
| `ManagedPlatform.visitRoots` | interop | Application, windows, singletons, pending objects, animation plans/targets/children and saved animation targets |
| `HostOperations.visitRoots` | host-operation | Pending operation task and captured managed receiver/arguments until completion or cancellation |
| `HostPayloadRoots` / `visitPayloadRoots` | host-operation | Storage owners, captured inputs, the current host read, observed replacement references and managed exceptions throughout one synchronous payload operation |
| Heap lifetime visitor | handle | Strong host handles and normal GCHandles; weak and weak-track-resurrection entries do not become ordinary roots |
| Heap pins and explicit allocation inputs | pinned | Scoped `withRoots`/`pinRoot` values, interior pin owners and allocation inputs during reserve/collection |
| Lifetime finalizer registry/context | finalizer | F-reachable queue, active finalizer object and parked finalizer frames; interrupted main execution remains visited while a finalizer runs |
| `RuntimeGC.visitRoots` | finalizer | Cooperative WaitForPendingFinalizers tasks |
| `DebuggerRootScope` | debugger | Evaluation results, watch results, variables and expanded children retained through strong handles for one debugger stop |
| `RuntimeGC.registerContextRoots` | static / interop | Explicit strong A04 context entries: static entries retain `static`; other instance/delegate entries retain `interop`; weak entries are excluded |
| Heap `rootRegistry` / VM `gcRuntime.rootRegistry` | registration category | Explicit extension providers, with independent instance ownership and disposable registrations |
| `ManagedHeap.retainObserverRoots` | stack | Collection roots retained by a temporary registry lease until deferred or reentrant observer delivery finishes |

Active scheduler frames are scanned once through the active VM; parked frames are scanned through the scheduler. Completed/faulted/canceled contexts and tasks are not permanent roots. The active finalizer context owns the runner root scan; RuntimeGC does not duplicate it.

## Publication and lifetime

A mutator publishes references through `writeRoot`, `writeStatic`, `writeField`, `writeElement`, `bulkCopy`, `fillArray`, or `replaceData`. These APIs notify incremental marking and remembered sets. A reference kept only in a JavaScript local across an allocation must enter `withRoots` or `pinRoot` first. `pinRoot` publishes through the root barrier; direct `pins.push` is not a publication API.

Public payload getters and setters can invoke managed collection. A `HostPayloadRoots` scope therefore registers one temporary `host-operation` provider before those callbacks. Its `payload-owner`, `payload-read` and `payload-value` details identify storage owners, the current callback result and captured values. Insertions also publish through the root barrier, except at explicitly disabled barrier-fuzzer sites. Closing the operation disposes its registration and clears managed references, captured values, scratch storage, the heap pointer and the disposal closure. Its closed flag is not rewound: snapshots preserve the scope owner's identity, so restoring a historical registry entry after closure leaves that entry inert and does not reactivate the completed operation's roots.

`GC.KeepAlive` publishes its argument through the root barrier at the call. Its interpreter local/argument lifetime already spans evaluation up to that call; the argument is not added to a new permanent root set after the call.

Debugger roots are deduplicated by full `{h,g}` identity. A bounded scope rejects excess retained values instead of silently dropping earlier results. Resuming or ending a stop clears its handles. Ending a VM disposes every attached scope and releases legacy evaluation handles.

`VM.stop()` cancels scheduler and host work, disposes attached context bridges, closes the platform through its lifetime-owned SafeHandle, discards pending finalizers under the .NET Core shutdown policy, clears execution/static/string/type/layout caches, and collects remaining collectible objects. Already terminated normal execution may still expose its platform/return state until explicit stop. Frozen literals are separate per-heap storage and survive ordinary collection; explicit `heap.dispose()` reclaims that storage too.

### Frozen and weak strings

Strong literal interning uses `heap.spaces.frozen.string`. Literal identities stay in the frozen identity index, outside `vm.strings`, so root scan cost does not grow with literal count. Dynamically interned ordinary strings remain static roots. With `weakStringInterning`, the ordinary intern pool does not keep its referents alive. Frozen arrays accept immutable scalar data only; outgoing collectible references are rejected.

### Assembly contexts

A04 contexts remain host metadata/lifetime objects. A host attaches an explicit registry using `vm.gcRuntime.registerContextRoots(context.roots)`, or passes `contextRoots` in VM options. The registration returns a disposable bridge. It does not traverse the session's weak registry or register unrelated contexts.

`ContextRoots.subscribe` publishes newly added strong targets synchronously through `collector.rootBarrier`, including additions after mark termination. Listener count is bounded at 1,024. Failed publication rolls back the new entry. Releasing the registration unsubscribes and removes its root provider. A context root release drops the managed root without resurrecting weak targets.

The VM snapshot records attached registry identities and revisions. Restore rejects a host context add/release or bridge attach/detach before mutating the heap: copying a managed heap cannot rewind external registry leases. Unchanged registries remain attached across a permitted restore. The bridge implements explicit root interoperation, not managed AssemblyLoadContext execution or CLR metadata unloading parity.

## Conservative miss audit

`auditRoots(vm, options)` independently inspects enumerable data properties, Map keys/values, Sets and debugger session state, searching for managed references outside the closure reported by production root providers. It never executes getters or host closures. The closure traces every stored heap slot without relying on the collector's descriptor scanner. A missing reference reports its owning path, such as `vm.forgotten.cache.get("selected")`.

The inventory in `gc/root-inventory.js` documents exclusions: heap storage traced independently, immutable executable metadata, derived indexes, weak containers, copied debugger history, host configuration/callbacks and opaque service objects whose managed roots have an explicit owner. Exclusions are semantic boundaries, not hashes of source text. Stale identities are reported separately. Traversal has object/edge budgets; exhausting a budget makes the audit unsuccessful.

`gcRootAudit: true` audits slice boundaries. Focused regressions cover a deliberately unregistered cache, getter avoidance, byref ownership and budget exhaustion. `tests/a06-roots-examples.test.js` audits every executable Studio example in source and direct CIL under allocation stress; the intentionally uncompilable `errors` example has no runtime image. External waits are audited while pending; this does not claim network, browser or Rust execution qualification.

## Safepoints and stress

`GCStress` accepts `alloc`, `instruction:N`, `call-return`, `all`, or `{alloc, every, calls, backedges, slices}`. `SHARPFORGE_GC_STRESS` supplies the default for the nightly suite; an explicit `false` disables it for heap-oracle fixtures. It forces generation-2 blocking collection with reentrancy protection and attaches the allocation/source site to collection failures.

Both interpreter loops publish materialized state at instructions, calls/returns, backward branches and slice boundaries. Allocation roots enter their scope before allocation stress runs. The cooperative safepoint coordinator suspends registered contexts before collection; materialized interpreter state remains visible during host calls. Finalizers execute in bounded independent interpreter frames between slices. No conservative scan of a native/Rust stack is implied; those implementations must publish their own roots before yielding.

Managed callbacks and finalizers can select CIL methods outside the original entry point's reachable graph. Before switching execution state, the runtime verifies the selected method and its reachable callees with the existing CIL execution-profile verifier. Only a successful graph within the VM's combined method limit extends its verification report. Repeated calls reuse that report, and ordinary call dispatch retains its verified-method gate. Rejected callback or finalizer IL leaves the interrupted execution state intact.

## Allocation review gate

`tests/a06-rooting-inventory.js` enumerates managed heap allocation calls in runtime (including GC adapters), debugger and BCL sources. The checked-in `tests/a06-rooting-reviews.json` records a rooting policy and exact call count for every readable callable scope, including module-owned handler tables. A new allocation or scope changes the inventory and requires review. It ignores comments/string literals and does not treat an ordinary call statement as a function declaration.

The review covers nested construction, copied struct boxing, exception construction, recursive host marshaling, platform defaults, string concatenation/splitting, numeric result arrays, GCMemoryInfo materialization and temporary collection storage. Separate stress and proxy tests exercise the production paths; the lexical inventory is an obligation tracker, not a proof that an arbitrary JavaScript function is correctly rooted.

The generic GC array adapter converts its rooted arguments to host length, pin flag and element name before one zero-initialized array allocation. Allocation pins the result during observers; both interpreters publish the returned identity through their stack root barrier without another managed allocation in between. The source and direct-CIL cases in `tests/a06-api-arrays.test.js` exercise reference-element handoff under allocation stress and the root miss audit.

## Snapshot ownership

Snapshot heaps are independent historical copies and do not root their former records in the current live heap. Restore checks VM owner and preserves monotonic handle/frame identities. The heap extension registry and VM extension registry are distinct snapshot components. Registry dispose leases remain idempotent after restoration. Active managed finalizers snapshot their parked frames through the runner contract; uncloneable host generators are rejected explicitly.

## Reviewed root boundary sites

The lexical gate inventories callable `roots` and `rootValues` entries, `visit*Roots` definitions/calls/assignments, `rootProvider` and `rootVisitor` slots, `RootRegistry` construction and direct registration (including locally assigned registries), context bridges and safepoint `publishRoots` hooks. Runtime, debugger and CLR source directories are inspected. Comments, ordinary strings and regular expressions do not count; executable template interpolations do.

These are ownership boundary sites, including both a provider and its dispatch calls, not a count of independent root sets. The gate does not infer arbitrary aliases or dynamically constructed property names; the independent runtime miss audit remains necessary. Every newly discovered site needs its own reviewed ID below. Existing iterable IDs remain valid. `node scripts/planning/check-root-providers.js --generate` refreshes source locations in `gc-roots-sites.json`; updating that JSON alone does not approve a new provider.

### cil-vm.js

CIL entry installs the VM visitor; the iterable adapter remains available to existing clients.

- `cil-vm.js:rootVisitor:1` — rootVisitor at line 33.
- `cil-vm.js:visitRoots:1` — visitRoots at line 33.
- `cil-vm.js:visitRoots:2` — visitRoots at line 42.
- `cil-vm.js:visitVMRoots:1` — visitVMRoots at line 42.
- `cil-vm.js:roots:1` — roots at line 43.
- `cil-vm.js:rootValues:1` — rootValues at line 43.

### execution/source-eh.js

Compatibility enumeration of rooted exception and unwind continuations.

- `execution/source-eh.js:roots:1` — roots at line 7.

### execution/strings.js

Compatibility enumeration of strong dynamic intern entries; weak entries stay excluded.

- `execution/strings.js:roots:1` — roots at line 24.
- `execution/strings.js:roots:2` — roots at line 38.

### gc/background-graph.js

Snapshots actual heap root identities into the worker graph before background marking.

- `gc/background-graph.js:visitRoots:1` — visitRoots at line 53.

### gc/barrier-fuzzer.js

Explicit test-only roots for the independent barrier omission fixture.

- `gc/barrier-fuzzer.js:rootVisitor:1` — rootVisitor at line 28.

### gc/collector.js

Seeds and rescans the marker at collection boundaries.

- `gc/collector.js:roots:1` — roots at line 188.
- `gc/collector.js:roots:2` — roots at line 199.

### gc/context-roots.js

Registers and publishes strong assembly-context entries; bridge disposal removes the provider.

- `gc/context-roots.js:RootRegistry.register:1` — RootRegistry.register at line 16.
- `gc/context-roots.js:visitRoots:1` — visitRoots at line 16.
- `gc/context-roots.js:visitRoots:2` — visitRoots at line 18.
- `gc/context-roots.js:visitRoots:3` — visitRoots at line 27.

### gc/finalization.js

Visits queued f-reachable objects and delegates active finalizer execution roots.

- `gc/finalization.js:visitRoots:1` — visitRoots at line 127.
- `gc/finalization.js:visitRoots:2` — visitRoots at line 131.

### gc/finalizer-context.js

Retains the active finalizable object and the runner's suspended execution.

- `gc/finalizer-context.js:visitRoots:1` — visitRoots at line 124.
- `gc/finalizer-context.js:visitRoots:2` — visitRoots at line 127.

### gc/finish-mark.js

Final root rescan before dependent, weak and finalizer processing.

- `gc/finish-mark.js:roots:1` — roots at line 3.

### gc/heap-dump.js

Diagnostic root traversal with category-labelled graph edges.

- `gc/heap-dump.js:visitRoots:1` — visitRoots at line 63.

### gc/heap-state.js

Initializes empty provider slots and the independent heap extension registry.

- `gc/heap-state.js:rootProvider:1` — rootProvider at line 51.
- `gc/heap-state.js:rootVisitor:1` — rootVisitor at line 52.
- `gc/heap-state.js:RootRegistry:1` — RootRegistry at line 53.

### gc/heap.js

Composes VM, extension, temporary and lifetime roots; leases observer roots and clears providers on disposal.

- `gc/heap.js:visitRoots:1` — visitRoots at line 56.
- `gc/heap.js:rootVisitor:1` — rootVisitor at line 60.
- `gc/heap.js:rootProvider:1` — rootProvider at line 61.
- `gc/heap.js:visitRoots:2` — visitRoots at line 62.
- `gc/heap.js:visitStrongRoots:1` — visitStrongRoots at line 65.
- `gc/heap.js:RootRegistry.register:1` — RootRegistry.register at line 81.
- `gc/heap.js:rootVisitor:2` — rootVisitor at line 148.
- `gc/heap.js:rootProvider:2` — rootProvider at line 149.

### gc/host-handles.js

Visits strong handle targets with stored categories; weak/dependent handles are excluded.

- `gc/host-handles.js:visitStrongRoots:1` — visitStrongRoots at line 152.

### gc/host-payload-roots.js

Retains the storage owners and callback values described in the synchronous host-payload policy above. The registration is disposed at operation exit, and a restored closed owner remains inert.

- `gc/host-payload-roots.js:visitPayloadRoots:1` — visitPayloadRoots at line 4.
- `gc/host-payload-roots.js:RootRegistry.register:1` — RootRegistry.register at line 21.

### gc/incremental-mark.js

Connects categorized heap root visitation to precise incremental marking.

- `gc/incremental-mark.js:roots:1` — roots at line 164.
- `gc/incremental-mark.js:visitRoots:1` — visitRoots at line 165.

### gc/lifetime.js

Composes strong handle, explicit pin and finalizer roots.

- `gc/lifetime.js:visitStrongRoots:1` — visitStrongRoots at line 134.
- `gc/lifetime.js:visitStrongRoots:2` — visitStrongRoots at line 135.
- `gc/lifetime.js:visitRoots:1` — visitRoots at line 136.
- `gc/lifetime.js:visitRoots:2` — visitRoots at line 137.

### gc/managed-callback.js

Retains interrupted VM execution while a bounded managed callback runs.

- `gc/managed-callback.js:visitVMRoots:1` — visitVMRoots at line 53.

### gc/managed-finalizer.js

Keeps interrupted main execution and parked independent finalizer frames visible.

- `gc/managed-finalizer.js:visitRoots:1` — visitRoots at line 110.
- `gc/managed-finalizer.js:visitExecutionRoots:1` — visitExecutionRoots at line 111.
- `gc/managed-finalizer.js:visitExecutionRoots:2` — visitExecutionRoots at line 112.

### gc/pinning.js

Every outstanding explicit pin retains its owner until its last lease is released.

- `gc/pinning.js:visitRoots:1` — visitRoots at line 68.

### gc/provider-visitors.js

Visits nonterminal scheduler state, platform/animation state and pending host operations.

- `gc/provider-visitors.js:visitSchedulerRoots:1` — visitSchedulerRoots at line 5.
- `gc/provider-visitors.js:visitExecutionRoots:1` — visitExecutionRoots at line 16.
- `gc/provider-visitors.js:visitPlatformRoots:1` — visitPlatformRoots at line 33.
- `gc/provider-visitors.js:visitRoots:1` — visitRoots at line 34.
- `gc/provider-visitors.js:visitHostOperationRoots:1` — visitHostOperationRoots at line 43.

### gc/retention.js

Diagnostic traversal starts from the same categorized production roots.

- `gc/retention.js:visitRoots:1` — visitRoots at line 66.

### gc/root-audit.js

The independent closure oracle seeds from the production root visitor.

- `gc/root-audit.js:visitRoots:1` — visitRoots at line 19.

### gc/roots.js

Defines scoped provider ownership, frame/VM composition and compatibility materialization.

- `gc/roots.js:RootRegistry:1` — RootRegistry at line 18.
- `gc/roots.js:visitRoots:1` — visitRoots at line 31.
- `gc/roots.js:rootValues:1` — rootValues at line 50.
- `gc/roots.js:visitRoots:2` — visitRoots at line 52.
- `gc/roots.js:visitFrameRoots:1` — visitFrameRoots at line 66.
- `gc/roots.js:visitExecutionRoots:1` — visitExecutionRoots at line 81.
- `gc/roots.js:visitFrameRoots:2` — visitFrameRoots at line 87.
- `gc/roots.js:visitVMRoots:1` — visitVMRoots at line 90.
- `gc/roots.js:visitExecutionRoots:2` — visitExecutionRoots at line 91.
- `gc/roots.js:visitRoots:3` — visitRoots at line 101.
- `gc/roots.js:visitRoots:4` — visitRoots at line 102.
- `gc/roots.js:visitRoots:5` — visitRoots at line 103.

### gc/runtime-integration.js

Owns VM extension/context registrations, finalizer-wait roots and a materialized safepoint publisher.

- `gc/runtime-integration.js:RootRegistry:1` — RootRegistry at line 19.
- `gc/runtime-integration.js:registerContextRoots:1` — registerContextRoots at line 30.
- `gc/runtime-integration.js:publishRoots:1` — publishRoots at line 33.
- `gc/runtime-integration.js:visitRoots:1` — visitRoots at line 49.
- `gc/runtime-integration.js:visitRoots:2` — visitRoots at line 50.
- `gc/runtime-integration.js:registerContextRoots:2` — registerContextRoots at line 55.

### gc/safepoints.js

Accepts and invokes explicit root publication hooks while registered contexts are stopped.

- `gc/safepoints.js:publishRoots:1` — publishRoots at line 30.
- `gc/safepoints.js:publishRoots:2` — publishRoots at line 38.
- `gc/safepoints.js:publishRoots:3` — publishRoots at line 63.

### gc/verify.js

Heap verification starts from actual registered roots.

- `gc/verify.js:visitRoots:1` — visitRoots at line 65.

### host-operations.js

Routes pending operation captures through their explicit visitor and compatibility adapter.

- `host-operations.js:visitRoots:1` — visitRoots at line 8.
- `host-operations.js:visitHostOperationRoots:1` — visitHostOperationRoots at line 8.
- `host-operations.js:roots:1` — roots at line 9.
- `host-operations.js:rootValues:1` — rootValues at line 9.

### platform.js

Routes live platform and animation values through their explicit visitor and compatibility adapter.

- `platform.js:visitRoots:1` — visitRoots at line 18.
- `platform.js:visitPlatformRoots:1` — visitPlatformRoots at line 18.
- `platform.js:roots:1` — roots at line 19.
- `platform.js:rootValues:1` — rootValues at line 19.

### scheduler.js

Routes nonterminal and parked execution through its explicit visitor and compatibility adapter.

- `scheduler.js:visitRoots:1` — visitRoots at line 30.
- `scheduler.js:visitSchedulerRoots:1` — visitSchedulerRoots at line 30.
- `scheduler.js:roots:1` — roots at line 31.
- `scheduler.js:rootValues:1` — rootValues at line 31.

### vm.js

Source entry installs the VM visitor; the iterable adapter remains available to existing clients.

- `vm.js:rootVisitor:1` — rootVisitor at line 23.
- `vm.js:visitRoots:1` — visitRoots at line 23.
- `vm.js:visitRoots:2` — visitRoots at line 27.
- `vm.js:visitVMRoots:1` — visitVMRoots at line 27.
- `vm.js:roots:1` — roots at line 28.
- `vm.js:rootValues:1` — rootValues at line 28.

### debugger/evaluation.js

Pins interrupted VM roots while effectful debugger evaluation runs.

- `debugger/evaluation.js:roots:1` — roots at line 192.
