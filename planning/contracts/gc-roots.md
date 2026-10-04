# GC roots: current providers and obligations

The non-moving collector consumes the VM root provider, temporary pins, explicit allocation roots and strong handles. Weak handles do not keep objects alive. Interior addresses retain their managed owner; nested value records, Nullable payloads and explicit-layout reference sidecars must retain their reference fields.

The authoritative VM inventory is `execution/frame-roots.js`: `visitVMRoots`, `visitSchedulerRoots`, `visitFrameRoots` and `visitFrameContinuations`. The source and CIL `roots()` methods expose conservative iterable wrappers over that inventory. `installRootProvider` permits direct visitor traversal for normal collection, and preserves the iterable contract and a host override of `vm.roots`. Canonical declared scalar slots may be omitted only after checking the actual value; metadata alone never proves a host-edited slot contains no reference. Frame liveness pruning also preserves captured local/argument addresses and suspended continuations.

| Category | Provider | Roots and lifetime |
| --- | --- | --- |
| Active source/CIL frames | `visitVMRoots`, `visitFrameRoots` | Source shared stack and frame locals; CIL args, locals and evaluation stacks; constructor return objects. Declared scalar filtering preserves unexpected references. |
| Suspended control | `visitFrameContinuations` | Object equality/hash callbacks, array search/copy/sort state, delegate arguments/entries, async builders, exception filters/events, return/unwind values, caught faults and pending faults. |
| Fault diagnostics | `visitFaultRoots` | Fault references and nested first-chance failure diagnostics, including original callback continuation and subscriber failure; cycle-safe traversal. |
| Retired frames | `visitRetiredFrames` | Frames remain roots until the instruction's retirement flush because return/EH callbacks can still inspect them. |
| Static/cache | `visitVMRoots` | Static fields, source constants, initialization state, canonical runtime type objects and strong interned strings. Weak interned strings deliberately do not retain referents. |
| Parked contexts | `visitSchedulerRoots` | Live context task/thread/delegate/wait state, stack, frames, return value and faults. The current context is not traversed twice when it aliases active frames. Terminal context history is excluded. |
| Pending tasks | `visitSchedulerRoots` | Nonterminal task reference, dependencies, error, async state machine and awaited task. Terminal task payload history is excluded. |
| Synchronous callbacks | `visitSchedulerRoots` | Saved callback scopes retain suspended caller stack/frames, return value and faults, including when cooperative scheduling is disabled. |
| Synchronization | `SyncPrimitives.roots` | Monitor owner objects, pending entry/condition tasks and managed owners of lockTaken addresses. |
| Platform | `ManagedPlatform.roots` | Application, windows, singletons, pending objects, host operations and animation providers. |
| Host operations | `HostOperations.roots` | Active task reference and captured managed arguments/receivers. |
| Handles and temporaries | Heap collection/allocation | Strong handles, `withRoots` pins, explicit roots and new input edges. The allocated reference and explicit caller roots stay pinned through synchronous allocation observers. |
| Snapshots | Snapshot heap copies | Saved heap record versions own independent contents and are not additional live-heap roots. Full restore validates captured memory before replacing live state. |

Local snapshot restore remains owner-bound. Portable snapshot serialization uses a separate, versioned graph format to rebind owned identities into a VM with matching code, engine and native width; it does not turn saved references into roots in the original live heap. Restoring preserves monotonic generation and frame identities. Native/Rust stacks must publish roots explicitly before yielding; no conservative native stack scan is specified.

## Reviewed literal sites

The manifest enumerates every literal `roots(` definition or call under `packages/runtime/src`, including compatibility wrappers. `node scripts/planning/check-root-providers.js` rejects a new undocumented occurrence. This guard supplements the semantic inventory above: helpers using visitor names still require review and are not discovered by this lexical scan. `gc-roots-sites.json` records the current extracted line positions; source hashes are not a substitute for the audit.

- `cil-vm.js:roots:1` — the CIL iterable wrapper delegates to `rootValues(this)`.
- `execution/frame-roots.js:roots:1` — the shared VM inventory includes platform roots before collecting frames.
- `execution/frame-roots.js:roots:2` — the shared VM inventory includes synchronization roots.
- `execution/frame-roots.js:roots:3` — installed heap provider falls back to the public iterable for diagnostics, imprecise mode or a host override.
- `execution/source-eh.js:roots:1` — compatibility EH iterable retains direct unwind, event and exception references. Normal VM collection uses the shared continuation/fault visitors above.
- `execution/strings.js:roots:1` — strong intern pool entries only; a weak pool yields no referents.
- `execution/strings.js:roots:2` — the string-root adapter delegates to that pool for both VMs.
- `execution/sync-primitives.js:roots:1` — monitor objects and waiting tasks/address owners.
- `host-operations.js:roots:1` — active operation task and explicit captured roots.
- `platform.js:roots:1` — platform provider definition, including application, singleton, window and pending roots.
- `platform.js:roots:2` — delegation to host operation roots.
- `platform.js:roots:3` — delegation to animation roots.
- `scheduler.js:roots:1` — scheduler iterable wrapper delegates to the shared inventory.
- `vm.js:roots:1` — source iterable wrapper delegates to `rootValues(this)`.
