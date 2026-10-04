# A05 scalar, call, cache and frame capabilities

This is the implementation/API map for Project 7 parents #74, #75, #80, #81 and
#82, initially inspected at `a5f84cd47`. It supplements the revision-scoped
[acceptance audit](a05-project7-acceptance-audit.md); it does not replace its
historical observations or declare every child criterion complete.

Here **source** means the semantic `pipeline: 'bound'` compiler image and
`VirtualMachine`; **reload** means canonical CLI reloading through
`loadAssembly` followed by `VirtualMachine`; **CIL** means `CilVirtualMachine`
executing verified CLI. The legacy frontend has its own narrower profile.
An implementation row and a linked regression are not a claim that an unrun
platform, performance target or full suite passed.

## Scalar execution — #74 / T01

| API or operation | Implemented routes and contract | Regression and limits |
| --- | --- | --- |
| Integral arithmetic and conversion | Source, reload and CIL preserve signed/unsigned widths, checked overflow, wrapping, shifts, division and destination storage normalization. | [Numeric modes](source-numeric-modes.md); [a05-source-numeric-modes](../tests/a05-source-numeric-modes.test.js), [a05-numeric-conversions](../tests/a05-numeric-conversions.test.js), [a05-numeric-typed-array-writes](../tests/a05-numeric-typed-array-writes.test.js). |
| `float` and `double` | Single operations round to binary32; Double retains binary64. IEEE exceptional values, signed zero and the admitted BitConverter bitcasts share numeric helpers across routes. | [Float precision](a05-float-precision.md), [numeric intrinsics](a05-source-numeric-intrinsics.md); [a05-source-numeric-intrinsics](../tests/a05-source-numeric-intrinsics.test.js). Native NaN/conversion comparisons require their recorded oracle environment. |
| `decimal` | Shared exact coefficient/scale values and admitted arithmetic, rounding, conversion and GetBits contracts. | [Decimal runtime](decimal-runtime.md), [source Decimal families](source-decimal-rounding.md); [a05-source-decimal-floating-conversions](../tests/a05-source-decimal-floating-conversions.test.js), [a05-source-decimal-getbits](../tests/a05-source-decimal-getbits.test.js). This does not admit every framework overload. |
| `nativeIntBits: 32 \| 64` | Immutable per-VM native width, default 32, on source/reload/CIL. Layout, native arithmetic and snapshot compatibility use the selected width. | [a05-source-numeric-modes](../tests/a05-source-numeric-modes.test.js), [a05-source-numeric-intrinsics](../tests/a05-source-numeric-intrinsics.test.js); this option does not select the host process architecture. |

Run `node examples/runtime/scalar-semantics.mjs` for width wrapping, Single
rounding, exact decimal arithmetic, signed-zero bits, NaN and catchable arithmetic
faults through all three routes. The example uses an explicit expected trace and
stops each VM. Its focused regression is
`tests/a05-runtime-capability-examples.test.js`.

## Calls and receivers — #75 / T02

| Call form | Implemented route and contract | Runnable input / focused regression |
| --- | --- | --- |
| `ref`, `out`, `in`, ref returns and ref indexers | Source/reload/CIL retain owned locations through nested calls. Readonly value receivers use defensive copies; expired frame storage and incompatible writes are rejected. | [Managed-reference example](../examples/runtime/managed-references.mjs); [a05-byref-call-scenarios](../tests/a05-byref-call-scenarios.test.js), [a05-managed-address](../tests/a05-managed-address.test.js), [a05-frame-memory-retirement](../tests/a05-frame-memory-retirement.test.js). |
| Virtual and interface calls | Direct CIL supports class virtual slots. Source/reload/CIL share interface declaration-slot semantics, including closed generic methods, explicit implementations, most-specific defaults and boxed value receivers. Source class inheritance remains outside the semantic execution profile. | [Source interface profile](a05-source-interface-dispatch.md); [a05-source-interface-dispatch](../tests/a05-source-interface-dispatch.test.js), [a05-source-generic-interface-methods](../tests/a05-source-generic-interface-methods.test.js), [a05-02-virtual-slots](../tests/a05-02-virtual-slots.test.js). |
| Closed generic calls and constrained values | Metadata substitution keeps receiver and method arguments distinct; constraint, receiver, storage and verifier admission gates still apply. | [Generic identity](a05-source-generic-type-identities.md), [constrained Object slots](a05-constrained-object-slots.md); [a05-source-generic-type-identities](../tests/a05-source-generic-type-identities.test.js), [a05-constrained-object-slots](../tests/a05-constrained-object-slots.test.js), [a05-generic-boxed-bcl-callback](../tests/a05-generic-boxed-bcl-callback.test.js). |
| Delegates and callbacks | CIL supports managed binding and invocation-list behavior. Registered source guest delegates preserve method/receiver identity, captures, multicast removal and callback continuations across reload. | [Guest callback profile](a05-source-guest-delegates.md); [a05-delegate-targets](../tests/a05-delegate-targets.test.js), [a05-source-appdomain-events](../tests/a05-source-appdomain-events.test.js), [a05-exception-event-policy](../tests/a05-exception-event-policy.test.js). External host calls remain governed by registered contracts. |
| Managed `calli` | Direct CIL accepts verified VM-owned function pointers with exact calling signatures, including supported instance and virtual pointer forms. | [Runnable native/CIL fixture](../tests/fixtures/a05-calli/README.md); [a05-managed-calli](../tests/a05-managed-calli.test.js), [a05-managed-instance-calli](../tests/a05-managed-instance-calli.test.js), [a05-virtual-instance-calli](../tests/a05-virtual-instance-calli.test.js). Source function-pointer calls still report SF2200; no source/reload claim is made. |
| `tail.` and variable arguments | Direct CIL uses verified tail groups and frame replacement only where caller storage can retire safely; otherwise the ordinary call path preserves lifetime. Source varargs has its separate admitted lowering. | [a05-02-tailcall](../tests/a05-02-tailcall.test.js), [a05-tail-prefix-groups](../tests/a05-tail-prefix-groups.test.js), [a05-02-varargs](../tests/a05-02-varargs.test.js), [a05-02-source-varargs](../tests/a05-02-source-varargs.test.js); [native qualification commands](a05-control-native-qualification.md). Unmanaged P/Invoke and arbitrary native pointers are outside these managed contracts. |

Run `node examples/runtime/managed-references.mjs` for Swap, aliasing, out writes,
ref indexers, collection during a live byref, readonly struct receivers and bounds
faults on source/reload/CIL. The indexer regression also checks one getter call per
assignment/compound/postfix operation and evaluation order. The native calli
fixture requires an actual compatible SDK and is qualified separately from this
JavaScript example; its expected text is not fresh native evidence.

## Preparation and call-site caches — #80 / T07

| Public API / option | Contract | Regression |
| --- | --- | --- |
| `prepareExecution(vm)` | Prepares source fusion or verified CIL decode plans without advancing guest instructions, tasks or optional Wasm compilation. Returns a frozen report; stopped/foreign VMs are rejected. Source `sourceFusion: false` reports `disabled`. | [a05-12-harness](../tests/a05-12-harness.test.js); the public `executionPreparationCapabilities` describes phase availability. |
| `executionCodeStatistics(vm)` | Frozen per-epoch decode/source-plan timing and work counters. Counters diagnose preparation and selected execution paths; they are not host allocation or throughput measurements. | [a05-decode-plan](../tests/a05-decode-plan.test.js), [a05-source-fusion](../tests/a05-source-fusion.test.js), [a05-numeric-blocks](../tests/a05-numeric-blocks.test.js). |
| `invalidateExecutionCode(vm, reason)` | Drops derived plans, metadata and call-site state after a committed edit. It does not validate or authorize an edit. In-place code/metadata mutations require explicit invalidation; debugger Hot Reload supplies the supported edit protocol. | [a05-token-cache](../tests/a05-token-cache.test.js), [a05-inline-cache](../tests/a05-inline-cache.test.js); rejected edits/restores preserve existing execution. |
| `decodePlans`, `inlineCaches`, `inlineCacheSize`, `sourceFusion` | `false` selects ordinary dispatch for the relevant path. CIL virtual caches default to four receiver types per site; the admitted capacity is 1–16, then megamorphic fallback stops retaining receiver entries. | [a05-inline-cache](../tests/a05-inline-cache.test.js), [a05-prepared-virtual-calls](../tests/a05-prepared-virtual-calls.test.js), [a05-source-fusion-blocks](../tests/a05-source-fusion-blocks.test.js), [a05-source-prepared-calls](../tests/a05-source-prepared-calls.test.js). Cache metadata is not a managed root or snapshot payload. |

Run `node examples/runtime/execution-caches.mjs`. It prepares each of the three
routes, executes one instruction, explicitly invalidates/reprepares, completes a
interface-call loop, then restores and replays the captured state. Assertions check
that preparation/invalidation do not execute guest code, epochs advance and the
trace/instruction count replay exactly. It prints observed epoch numbers, not a
speedup. The regression is [a05-runtime-capability-examples](../tests/a05-runtime-capability-examples.test.js).

## Numeric optimization options — #81 / T08

| CIL VM option | Implemented path | Fallback and example |
| --- | --- | --- |
| `specializeNumericHandlers: true` | Verified closed integer categories select specialized Int32/Int64 handlers; eligible integer sequences use bounded numeric blocks. | Unknown/host-edited categories keep shared handlers. [Int32 example](../examples/runtime/int32-specialization.mjs); [a05-numeric-blocks](../tests/a05-numeric-blocks.test.js), [a05-numeric-single-boundary](../tests/a05-numeric-single-boundary.test.js). |
| `typedNumericStack: true` | Private numeric/tag planes retain float values in frame storage; ordinary adapters expose immutable numeric values when needed. | Custom descriptors, replacement arrays and unsupported instructions preserve ordinary semantics. [Float example](../examples/runtime/typed-float-slots.mjs); [a05-typed-float-array](../tests/a05-typed-float-array.test.js), [a05-typed-float-cil](../tests/a05-typed-float-cil.test.js). |
| `smallLongs: true` | Exact safe-integer Int64 values use tagged numeric lanes; public reads and snapshots still expose BigInt. | Wide/unsafe arithmetic falls back before operands are consumed. [Small-long contract](small-long-slots.md); [a05-small-long-cil](../tests/a05-small-long-cil.test.js), [a05-small-long-division](../tests/a05-small-long-division.test.js), [a05-small-long-conversions](../tests/a05-small-long-conversions.test.js). |

These options are off by default and describe direct-CIL execution, not source
fusion or an automatic Rust/Wasm tier. They preserve instruction budgets, quota
faults, managed storage and snapshot semantics. Numeric blocks retain ordinary
dispatch at unsupported operations and observable debugger/profiler/event/GC
boundaries; see [bounded numeric blocks](cil-numeric-blocks.md).

The examples compare outputs. A dispatch counter, zero managed allocations or
zero scalar-carrier constructions does not prove zero JavaScript allocations.
Use the revision-scoped [paired qualification protocol](performance/a05-qualification.md)
and [float allocation evidence](performance/a05-float-allocation.md) for measured
claims. This table adds no new performance result.

## Frames and roots — #82 / T09

| API / option | Implemented contract | Regression and boundary |
| --- | --- | --- |
| `framePooling`, `framePoolBytes` | Source/reload/CIL reuse owned frames/arrays with fresh monotonic frame IDs. Default retention is 1 MiB of logical pool storage; `framePooling: false` disables retention. | [Pool contract](frame-pool-runtime.md); [a05-frame-pool](../tests/a05-frame-pool.test.js), [a05-frame-pool-lifecycle](../tests/a05-frame-pool-lifecycle.test.js), [a05-source-prepared-frame-pool](../tests/a05-source-prepared-frame-pool.test.js). Logical bytes are not host heap/RSS. |
| `framePoolStatistics(vm)` | Frozen pool-owned frame/array allocation, reuse, cached-frame and retained-byte counters. | Measures this pool's work; it does not count all host allocations. Snapshot restore and stop discard derived pools. |
| `preciseRoots` | Default visitor filters canonical scalar slots while retaining reference-bearing live state, callback scopes, parked contexts and pending retired storage. `false` uses the conservative compatibility inventory. | [Root visitor](frame-root-visitor.md); [a05-frame-root-visitor](../tests/a05-frame-root-visitor.test.js), [a05-callback-frame-index](../tests/a05-callback-frame-index.test.js). |
| `preciseRootLiveness: true` | Opt-in proof-based clearing of dead owned-reference argument/local slots in eligible active frames. Captures, EH/continuations, paused/faulted states and unproven metadata retain roots. | [Liveness example](../examples/runtime/reference-slot-liveness.mjs); [a05-reference-slot-liveness](../tests/a05-reference-slot-liveness.test.js). Effective pruning also requires `preciseRoots` to remain enabled. |
| `maxFrames`, `maxStackValues`, `maxStackBytes` | A default 4 MiB VM-wide logical stack budget replaces the implicit depth ceiling. Explicit depth limits and verified evaluation-stack bounds remain independent. | [Default stack policy](default-managed-stack-budget.md), [verified stacks](verified-stack-runtime.md), [frame identities](live-frame-index.md); [a05-default-stack-budget](../tests/a05-default-stack-budget.test.js), [a05-calli-stack-byte-budget](../tests/a05-calli-stack-byte-budget.test.js). Retiring a frame revokes stack/pin capabilities before storage reuse. |

Run `node examples/runtime/reference-slot-liveness.mjs` for last-use collection
and slot clearing. The 500-frame root-scan speed target, retained host memory,
browser/native/platform qualification and profiler overhead require their own
measurements. This document does not infer them from root correctness or pool
counters. The scalar-slot timing report at
[48c62243](https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/slots-virtual-48c62243/README.md) applies to that revision
and target; its virtual target still missed the required 3×.

## Validation scope of this documentation batch

The scalar example passed all three routes at `45ca8e0a4`. That combined run had
133 passes and one failure: the preparation example used class inheritance, which
the source execution profile rejects. The example now uses admitted interface
dispatch while retaining its preparation, invalidation and replay assertions;
this correction awaited the coordinated serial rerun at that checkpoint. The existing
managed-reference examples and getter-order regression passed all three routes
at `d9453a979` in the integration owner's 47-test run: 40 passed, zero failed,
seven existing reference-pack-dependent compiler tests skipped. Those skips do
not qualify an unavailable reference pack.

The later [broad7d archive][capability-broad] explicitly records the scalar and
preparation/invalidation/restore examples passing on all three routes (subtests
2114 and 2115), alongside the rectangular-memory and exception-order examples
(2130 and 2131). The complete selection passed 3,369 tests at `7d7fac37a`; these
four examples are part of that count, not additional results.

The [completed36 native archive][capability-native] adds actual native output
comparison for the exact managed-reference example and configured native widths,
with source/reload/compiler-CIL routes. Its unsupported SDK8 numeric and Unix
varargs outcomes remain explicit. These observations supersede missing-evidence
statements at earlier checkpoints; they do not qualify the later `1520f50b1`
async/task/snapshot reconciliation, current CI or pending performance targets.

```sh
node scripts/limited.js node --test tests/a05-runtime-capability-examples.test.js tests/a05-byref-call-scenarios.test.js tests/a05-12-harness.test.js tests/a05-reference-slot-liveness.test.js
```

Actual native/SDK/OS, browser, Speedscope, Wasm-host and final performance results
remain separate evidence. Run the [native matrix](a05-native-ci.md) and
[browser qualification](a05-browser-qualification.md) under their prescribed
environments; no simulator or authored expected trace substitutes for execution.

[capability-broad]: https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/integration-validation-20261004/broad-a05-7d7fac37a/README.md
[capability-native]: https://github.com/wieslawsoltes/SharpForge/blob/codex/a05-e01-started-handoff-20261004/planning/qualification/a05-evidence/ci-36a2af53-20261004/native/README.md
