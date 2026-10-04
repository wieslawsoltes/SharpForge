# Optional CIL float slots

`new CilVirtualMachine(assembly, {typedNumericStack: true})` enables private
Float64Array/tag planes for CIL frame operands, locals and arguments. The default
remains ordinary Arrays and performs no numeric category analysis or plane allocation.
This increment addresses #1395; its allocation measurements and broader qualification
remain open.

| Capability | Behavior |
| --- | --- |
| Verified direct CIL | Float constants, arithmetic, comparison branches, negation, float conversions, dup/pop and declared float slot loads/stores can use raw planes. |
| Calls, stores, debugger reads | Existing immutable `float` carriers are materialized where ordinary adapters need them. |
| Integer/native/Decimal values | Existing numeric handlers and carriers are retained. |
| Missing proof or unknown category | Existing CIL handlers execute unchanged. |
| `decodePlans: false` | Uses ordinary handlers, including their ordinary wrapper allocation. |
| Source/reloaded-source, Rust and Wasm qualification | Outside this direct-CIL increment; no support or performance result is claimed. |

The existing decode-plan cache owns specialization. It requires an exact successful
stack-bound proof and runs the existing conservative category analysis with a bounded
250,000-unit work allowance. Exceeding that allowance leaves the original handlers in
place. Every selected handler also checks the actual float tags and available capacity;
metadata alone never authorizes reading a host-edited value as a raw number.
Mixed r4/r8 arithmetic and Single rounding match the shared reference float policy.

Frame arrays remain `Array.isArray` compatible and support normal indexed access,
length, iteration, descriptors, splice and deletion. Only runtime-owned arrays are
wrapped before frames become visible. A host replacement Array keeps ordinary handlers.
Custom descriptors, prototype edits, freezing and sealing first materialize the array
and disable its raw path. Immutable scalar carriers preserve value/width semantics;
their JavaScript object identity is not a managed identity contract.

Declared locals retain storage rounding, uninitialized-read faults, byref writes and
debugger write notifications. A store with an active write callback uses the original
managed-address adapter. Replacing code/signature/local arrays invalidates specialized
plans; in-place metadata/code edits require `invalidateExecutionCode(vm, reason)` as
with other execution caches. Disabling the option switches dispatch to ordinary handlers;
already allocated arrays remain compatible until their frames retire.

Snapshots contain ordinary Arrays and immutable boundary carriers, never proxies,
typed planes, handlers or cache functions. Restore wraps the copied runtime arrays
before returning to the host and preserves shared local/argument aliases. The common
GC visitor scans the reference plane without constructing float wrappers, including
parked and pending-retirement frames. Normal pool truncation clears float tags,
cached boundary values and managed references. Logical `maxStackBytes` and
`framePoolBytes` contracts are unchanged; neither is a physical JavaScript heap estimate.

The manual Wasm bridge retains its existing dispatch/activity envelope. Typed handlers
are its ordinary fallback handlers; this change adds no Wasm tier or OSR behavior.
The runnable example is `examples/runtime/typed-float-slots.mjs`.

Serial Node 24 validation at `cb84b4c9` passed all 112 focused tests covering
Array behavior, raw float loops, IEEE edges, host edits, byrefs, quotas, verified
stacks, snapshots, collection, pool retirement and the existing manual Wasm bridge.
Broad native/browser qualification remains deferred. Zero per-iteration JS
allocation, throughput, cold/warm latency and p95/p99 remain unmeasured.
