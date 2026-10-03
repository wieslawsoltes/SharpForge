# GC roots: current providers and obligations

The non-moving collector calls ManagedHeap.rootProvider, pins, extra allocation roots and strong handles. Weak handles do not keep objects alive. Scanning must retain interior byref owners, not merely the byref wrapper. Inventory IDs below enumerate every literal `roots(` site (definitions and calls), including modules added outside the original issue's list. `node scripts/planning/check-root-providers.js` fails on a new undocumented occurrence; update this document after reviewing source extraction. Source hashes are not a substitute for this audit.

| Category | File and function | Roots |
| --- | --- | --- |
| Active frames | vm.js VirtualMachine.roots | locals, evaluation stack, return value, unwind return/fault, caught/pending/current faults |
| CIL active frames | cil-vm.js CilVirtualMachine.roots | args, locals, stack, constructor return object, byref owners, exceptions |
| Source exception continuations | execution/source-eh.js roots | unwind return values/faults, current/caught frame exceptions, VM current/pending faults |
| Static/cache | both VM roots | statics, cached constant references, interned strings and runtime type objects |
| Runtime type objects | execution/tokens.js runtimeTypeRoots | canonical System.Type objects, scoped to the VM and cleared on stop |
| Interned strings | execution/strings.js StringInternPool.roots / stringRoots | strong pool entries only; weak pool entries do not root referents |
| Parked contexts | scheduler.js CooperativeScheduler.roots | task/thread/delegate, wait task, frame state, resume fault; terminal contexts excluded |
| Pending tasks | scheduler.js CooperativeScheduler.roots | waiting task, dependencies, error reference |
| Platform | platform.js ManagedPlatform.roots | app, windows, singletons, pending objects, host and animation providers |
| Pending operations | host-operations.js HostOperations.roots | task ref and captured managed argument/receiver roots |
| Handles and temporaries | heap.js ManagedHeap.collect | strong handles, withRoots pins, explicit allocation roots and object input edges |
| Debugger snapshots | snapshot.js copyExecution; VM snapshot/restore | independent copied heap records, not additional live roots; same-owner restore only |

Snapshot heap copies retain old contents without making them current live objects. Restoring preserves monotonically increasing generation and frame identities. Native/Rust stacks must publish roots explicitly before yielding; no conservative native stack scan is specified.

## Reviewed sites
- `cil-vm.js:roots:1` — packages/runtime/src/cil-vm.js:30; ptions);this.heap.rootProvider=()=>this.roots();this.frames=[];this.statics=new
- `cil-vm.js:roots:2` — packages/runtime/src/cil-vm.js:38; reInitialized(entry.ownerToken); } *roots(){yield* this.platform?.roots()??[
- `cil-vm.js:roots:3` — packages/runtime/src/cil-vm.js:38; ); } *roots(){yield* this.platform?.roots()??[];yield* this.scheduler?.roots
- `cil-vm.js:roots:4` — packages/runtime/src/cil-vm.js:38; orm?.roots()??[];yield* this.scheduler?.roots()??[]; const root=function*(v)
- `host-operations.js:roots:1` — packages/runtime/src/host-operations.js:5; ;this.revision=0;this.closed=false;} *roots(){for(const op of this.active.valu
- `platform.js:roots:1` — packages/runtime/src/platform.js:17; perations=new HostOperations(this);} *roots(){yield* this.hostOperations.roots
- `platform.js:roots:2` — packages/runtime/src/platform.js:17; } *roots(){yield* this.hostOperations.roots();yield* this.animations.roots();y
- `platform.js:roots:3` — packages/runtime/src/platform.js:17; erations.roots();yield* this.animations.roots();yield this.application;yield* th
- `scheduler.js:roots:1` — packages/runtime/src/scheduler.js:26;  this.contexts.get(this.currentId);} *roots(){if(!this.enabled)return;for(cons
- `vm.js:roots:1` — packages/runtime/src/vm.js:15; ptions);this.heap.rootProvider=()=>this.roots();this.stack=[];this.frames=[];thi
- `vm.js:roots:2` — packages/runtime/src/vm.js:19; ;this.call(image.entryPoint,[]); } *roots(){yield* this.platform?.roots()??[
- `vm.js:roots:3` — packages/runtime/src/vm.js:19; ); } *roots(){yield* this.platform?.roots()??[];yield* this.scheduler?.roots
- `vm.js:roots:4` — packages/runtime/src/vm.js:19; orm?.roots()??[];yield* this.scheduler?.roots()??[];yield this.returnValue;yield

- `execution/source-eh.js:roots:1` — extracted source EH provider retains unwind values, fault references and caught exceptions; vm.js delegates to it. Scheduler frames continue to retain the same references while parked.

- `execution/strings.js:roots:1` — StringInternPool.roots yields strong interned references; weak interning deliberately yields none.
- `execution/strings.js:roots:2` — stringRoots delegates to the pool for both VM root scans; stop clears the pool and snapshots retain its managed handles.

## Reviewed A06 prerequisite root sites

- `gc/incremental-mark.js:roots:1` — packages/runtime/src/gc/incremental-mark.js:164; reviewed collector prerequisite, pending runtime activation.
